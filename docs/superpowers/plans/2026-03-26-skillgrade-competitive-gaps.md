# Skillgrade Competitive Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 6 gaps identified in competitive analysis against the Skillgrade framework, adding pass@k/pass^k metrics, ablation mode, script evaluator, trial presets, golden dataset loader, and simple skill eval shorthand.

**Architecture:** Each gap maps to a self-contained module that integrates with the existing runner/evaluator/CLI/reporting pipeline. pass@k/pass^k are pure math on existing FirstTryStats. Ablation runs the same test twice (with/without skill) and applies the existing Welch's t-test. Script evaluator spawns a child process and parses JSON output. Trial presets and simple mode are CLI/config sugar.

**Tech Stack:** TypeScript, Vitest, Zod (schema validation), Commander (CLI), chalk (terminal output)

---

### Task 1: pass@k and pass^k Metrics

**Files:**
- Modify: `src/utils/first-try-pass-rate.ts`
- Modify: `src/utils/first-try-pass-rate.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/reporting/terminal.ts`
- Modify: `src/reporting/markdown.ts`

**Context:** The RFC defines pass@k = 1-(1-p)^k (at least 1 success in k trials) and pass^k = p^k (all k trials succeed). We already compute `firstTryPassRate` which groups results by name and checks the first attempt. We need to extend this with per-trial success rate and derive pass@k/pass^k for configurable k values.

- [ ] **Step 1: Write the failing test for pass@k and pass^k computation**

```typescript
// In src/utils/first-try-pass-rate.test.ts — add new tests at the bottom

describe('computeTrialMetrics', () => {
  it('computes pass@k and pass^k from trial results', () => {
    // 3 tests, 5 repetitions each, 75% per-trial success rate
    const results: TestResult[] = [];
    for (let t = 0; t < 3; t++) {
      for (let r = 1; r <= 5; r++) {
        results.push({
          name: `test-${t}`,
          suite: 's',
          layer: 'llm',
          pass: r <= 4, // 4 of 5 pass = 80% per trial for each test
          toolCalls: [],
          evaluatorResults: [],
          latencyMs: 100,
          repetition: r,
        });
      }
    }

    const metrics = computeTrialMetrics(results, [1, 5, 10]);
    // Per-trial success rate = 0.8 for each test, so overall = 0.8
    expect(metrics.perTrialSuccessRate).toBeCloseTo(0.8, 2);
    // pass@1 = 1 - (1-0.8)^1 = 0.8
    expect(metrics.passAtK[1]).toBeCloseTo(0.8, 2);
    // pass@5 = 1 - (1-0.8)^5 = 1 - 0.2^5 ≈ 0.99968
    expect(metrics.passAtK[5]).toBeCloseTo(0.99968, 4);
    // pass^1 = 0.8^1 = 0.8
    expect(metrics.passHatK[1]).toBeCloseTo(0.8, 2);
    // pass^5 = 0.8^5 ≈ 0.32768
    expect(metrics.passHatK[5]).toBeCloseTo(0.32768, 4);
  });

  it('returns zeros for empty results', () => {
    const metrics = computeTrialMetrics([], [1, 5]);
    expect(metrics.perTrialSuccessRate).toBe(0);
    expect(metrics.passAtK[1]).toBe(0);
    expect(metrics.passHatK[1]).toBe(0);
  });

  it('handles single repetition (no repetition field)', () => {
    const results: TestResult[] = [
      { name: 'a', suite: 's', layer: 'llm', pass: true, toolCalls: [], evaluatorResults: [], latencyMs: 100 },
      { name: 'b', suite: 's', layer: 'llm', pass: false, toolCalls: [], evaluatorResults: [], latencyMs: 100 },
    ];
    const metrics = computeTrialMetrics(results, [1, 5]);
    expect(metrics.perTrialSuccessRate).toBeCloseTo(0.5, 2);
    expect(metrics.passAtK[1]).toBeCloseTo(0.5, 2);
    // pass@5 = 1 - 0.5^5 ≈ 0.96875
    expect(metrics.passAtK[5]).toBeCloseTo(0.96875, 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/utils/first-try-pass-rate.test.ts`
Expected: FAIL — `computeTrialMetrics` is not exported

- [ ] **Step 3: Add TrialMetrics type to types.ts**

Add after the `RunResult` interface (around line 101 in `src/core/types.ts`):

```typescript
export interface TrialMetrics {
  perTrialSuccessRate: number;
  passAtK: Record<number, number>;
  passHatK: Record<number, number>;
  kValues: number[];
}
```

- [ ] **Step 4: Implement computeTrialMetrics in first-try-pass-rate.ts**

Add at the bottom of `src/utils/first-try-pass-rate.ts`:

```typescript
import type { TrialMetrics } from '../core/types.js';

/**
 * Compute pass@k and pass^k metrics from repeated trial results.
 *
 * Groups results by test name, computes per-test success rate across
 * repetitions, then averages across tests to get the overall per-trial
 * success rate p. From p:
 *   pass@k = 1 - (1-p)^k  (at least 1 success in k trials)
 *   pass^k = p^k           (all k trials succeed)
 */
export function computeTrialMetrics(results: TestResult[], kValues: number[]): TrialMetrics {
  if (results.length === 0) {
    const zeros: Record<number, number> = {};
    for (const k of kValues) {
      zeros[k] = 0;
    }
    return { perTrialSuccessRate: 0, passAtK: { ...zeros }, passHatK: { ...zeros }, kValues };
  }

  const byName = new Map<string, TestResult[]>();
  for (const r of results) {
    const existing = byName.get(r.name) ?? [];
    existing.push(r);
    byName.set(r.name, existing);
  }

  let totalRate = 0;
  for (const [, attempts] of byName) {
    const passed = attempts.filter((a) => a.pass).length;
    totalRate += passed / attempts.length;
  }
  const p = totalRate / byName.size;

  const passAtK: Record<number, number> = {};
  const passHatK: Record<number, number> = {};
  for (const k of kValues) {
    passAtK[k] = 1 - Math.pow(1 - p, k);
    passHatK[k] = Math.pow(p, k);
  }

  return { perTrialSuccessRate: p, passAtK, passHatK, kValues };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/utils/first-try-pass-rate.test.ts`
Expected: PASS

- [ ] **Step 6: Add trialMetrics to RunResult**

In `src/core/types.ts`, add to the `RunResult` interface (after line 100 `derivedMetrics`):

```typescript
  trialMetrics?: TrialMetrics;
```

- [ ] **Step 7: Wire trialMetrics computation into runner.ts**

In `src/core/runner.ts`, import `computeTrialMetrics` at the top:

```typescript
import { computeTrialMetrics } from '../utils/first-try-pass-rate.js';
```

After the `confidenceIntervals` computation (around line 335), add:

```typescript
  const repetitions = options.repeat ?? config.defaults?.repetitions ?? 1;
  const kValues = [1, repetitions, 10].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  const trialMetrics = repetitions > 1 ? computeTrialMetrics(allTests, kValues) : undefined;
```

Then add `trialMetrics` to the `runResult` object (after `confidenceIntervals`):

```typescript
    trialMetrics,
```

- [ ] **Step 8: Print trialMetrics in terminal report**

In `src/reporting/terminal.ts`, add a new function before `printTerminalReport`:

```typescript
function printTrialMetrics(result: RunResult): void {
  if (!result.trialMetrics) return;
  const tm = result.trialMetrics;

  log.divider();
  log.info(chalk.bold('  Trial Metrics'));
  log.info('');
  log.info(`  Per-trial success rate: ${(tm.perTrialSuccessRate * 100).toFixed(1)}%`);
  log.info('');

  const rows: string[][] = [['k', 'pass@k', 'pass^k']];
  for (const k of tm.kValues) {
    rows.push([
      String(k),
      `${(tm.passAtK[k] * 100).toFixed(1)}%`,
      `${(tm.passHatK[k] * 100).toFixed(1)}%`,
    ]);
  }
  log.table(rows);
  log.info('');
}
```

Then call it in `printTerminalReport` after `printConfidenceIntervals(result)`:

```typescript
  printTrialMetrics(result);
```

- [ ] **Step 9: Add trialMetrics to markdown report**

In `src/reporting/markdown.ts`, add a section after confidence intervals:

```typescript
  if (result.trialMetrics) {
    const tm = result.trialMetrics;
    lines.push('## Trial Metrics');
    lines.push('');
    lines.push(`Per-trial success rate: **${(tm.perTrialSuccessRate * 100).toFixed(1)}%**`);
    lines.push('');
    lines.push('| k | pass@k | pass^k |');
    lines.push('|--:|-------:|-------:|');
    for (const k of tm.kValues) {
      lines.push(`| ${k} | ${(tm.passAtK[k] * 100).toFixed(1)}% | ${(tm.passHatK[k] * 100).toFixed(1)}% |`);
    }
    lines.push('');
  }
```

- [ ] **Step 10: Commit**

```bash
git add src/utils/first-try-pass-rate.ts src/utils/first-try-pass-rate.test.ts src/core/types.ts src/core/runner.ts src/reporting/terminal.ts src/reporting/markdown.ts
git commit -m "feat: add pass@k and pass^k probabilistic trial metrics"
```

---

### Task 2: Script Evaluator (Inline Bash Graders)

**Files:**
- Create: `src/evaluators/script.ts`
- Create: `src/evaluators/script.test.ts`
- Modify: `src/evaluators/index.ts`

**Context:** Skillgrade lets users write inline bash scripts that output `{"score": 0.75}`. We need a `script` evaluator that executes a shell command and parses JSON output with at minimum a `score` field (0-1).

- [ ] **Step 1: Write the failing test**

```typescript
// src/evaluators/script.test.ts
import { describe, it, expect } from 'vitest';
import { ScriptEvaluator } from './script.js';
import type { EvaluatorContext } from '../core/types.js';

function makeContext(overrides: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    testName: 'test-1',
    toolCalls: [],
    finalOutput: 'hello world',
    ...overrides,
  };
}

describe('ScriptEvaluator', () => {
  it('runs a shell command and parses JSON score', async () => {
    const evaluator = new ScriptEvaluator();
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: 'echo \'{"score": 0.75}\'',
        },
      }),
    );
    expect(result.score).toBeCloseTo(0.75);
    expect(result.pass).toBe(true);
  });

  it('fails when script exits non-zero', async () => {
    const evaluator = new ScriptEvaluator();
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: 'exit 1',
        },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
  });

  it('passes finalOutput as EVAL_OUTPUT env var', async () => {
    const evaluator = new ScriptEvaluator();
    const result = await evaluator.evaluate(
      makeContext({
        finalOutput: 'test-output',
        config: {
          run: 'echo "{\\\"score\\\": 1.0}"',
        },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('defaults to threshold 0.5', async () => {
    const evaluator = new ScriptEvaluator();
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: 'echo \'{"score": 0.3}\'',
        },
      }),
    );
    expect(result.score).toBeCloseTo(0.3);
    expect(result.pass).toBe(false);
  });

  it('respects custom threshold', async () => {
    const evaluator = new ScriptEvaluator();
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: 'echo \'{"score": 0.3}\'',
          threshold: 0.2,
        },
      }),
    );
    expect(result.pass).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/script.test.ts`
Expected: FAIL — cannot resolve `./script.js`

- [ ] **Step 3: Implement ScriptEvaluator**

```typescript
// src/evaluators/script.ts
import { execSync } from 'child_process';
import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';

interface ScriptOutput {
  score: number;
  label?: string;
  explanation?: string;
}

export class ScriptEvaluator implements Evaluator {
  name = 'script';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const run = context.config?.run as string | undefined;
    if (!run) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: 'No "run" command specified in evaluator config',
      };
    }

    const threshold = (context.config?.threshold as number | undefined) ?? 0.5;

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      EVAL_OUTPUT: context.finalOutput ?? '',
      EVAL_PROMPT: context.prompt ?? '',
      EVAL_TEST_NAME: context.testName,
    };

    try {
      const stdout = execSync(run, {
        encoding: 'utf-8',
        timeout: 30_000,
        env,
        shell: '/bin/sh',
      }).trim();

      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          evaluator: this.name,
          score: 0,
          pass: false,
          label: 'parse-error',
          explanation: `Script output is not JSON: ${stdout.slice(0, 200)}`,
        };
      }

      const parsed = JSON.parse(jsonMatch[0]) as ScriptOutput;
      const score = Math.max(0, Math.min(1, parsed.score));

      return {
        evaluator: this.name,
        score,
        pass: score >= threshold,
        label: parsed.label,
        explanation: parsed.explanation,
        metadata: { threshold },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Script failed: ${message.slice(0, 300)}`,
      };
    }
  }
}
```

- [ ] **Step 4: Register the evaluator in index.ts**

In `src/evaluators/index.ts`, add import:

```typescript
import { ScriptEvaluator } from './script.js';
```

Add `'script'` to `EVALUATOR_NAMES` array (after `'resistance'`):

```typescript
  'script',
```

Add to `EVALUATOR_MAP`:

```typescript
  script: ScriptEvaluator,
```

Add to the export block:

```typescript
  ScriptEvaluator,
```

- [ ] **Step 5: Run tests to verify everything passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/script.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/evaluators/script.ts src/evaluators/script.test.ts src/evaluators/index.ts
git commit -m "feat: add script evaluator for inline bash graders"
```

---

### Task 3: Named Trial Presets (--smoke, --reliable, --regression)

**Files:**
- Modify: `src/cli/main.ts`
- Create: `src/cli/presets.ts`
- Create: `src/cli/presets.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/cli/presets.test.ts
import { describe, it, expect } from 'vitest';
import { resolveRepeatFromPreset, TRIAL_PRESETS } from './presets.js';

describe('resolveRepeatFromPreset', () => {
  it('returns 5 for smoke', () => {
    expect(resolveRepeatFromPreset('smoke')).toBe(5);
  });

  it('returns 20 for reliable', () => {
    expect(resolveRepeatFromPreset('reliable')).toBe(20);
  });

  it('returns 50 for regression', () => {
    expect(resolveRepeatFromPreset('regression')).toBe(50);
  });

  it('returns undefined for unknown preset', () => {
    expect(resolveRepeatFromPreset(undefined)).toBeUndefined();
  });

  it('exports preset map', () => {
    expect(TRIAL_PRESETS).toEqual({ smoke: 5, reliable: 20, regression: 50 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/cli/presets.test.ts`
Expected: FAIL — cannot resolve `./presets.js`

- [ ] **Step 3: Implement presets.ts**

```typescript
// src/cli/presets.ts

export const TRIAL_PRESETS: Record<string, number> = {
  smoke: 5,
  reliable: 20,
  regression: 50,
};

export function resolveRepeatFromPreset(preset: string | undefined): number | undefined {
  if (!preset) return undefined;
  return TRIAL_PRESETS[preset];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/cli/presets.test.ts`
Expected: PASS

- [ ] **Step 5: Wire presets into CLI**

In `src/cli/main.ts`, import:

```typescript
import { resolveRepeatFromPreset, TRIAL_PRESETS } from './presets.js';
```

Add a new option to the `run` command (after `--repeat`):

```typescript
  .option('--preset <name>', `trial preset: smoke (5), reliable (20), regression (50)`)
```

Update the `runCommand` function signature to include `preset?: string`, and resolve it:

```typescript
  const repeat = opts.repeat ?? resolveRepeatFromPreset(opts.preset);
```

Replace `opts.repeat` with `repeat` in the `runEvaluation` call.

- [ ] **Step 6: Commit**

```bash
git add src/cli/presets.ts src/cli/presets.test.ts src/cli/main.ts
git commit -m "feat: add --preset flag for named trial presets (smoke/reliable/regression)"
```

---

### Task 4: Golden Dataset Loader

**Files:**
- Create: `src/dataset/golden-loader.ts`
- Create: `src/dataset/golden-loader.test.ts`
- Modify: `src/core/config.ts` (add `golden_dataset` to YAML schema)
- Modify: `src/layers/skill/index.ts` (integrate golden datasets)

**Context:** The RFC proposes pairing test inputs with "golden" ground-truth outputs. We need a loader that reads a JSONL/JSON file of `{input, golden_output}` pairs and auto-generates LlmTestConfig entries with the `correctness` evaluator comparing against the golden output.

- [ ] **Step 1: Write the failing test for golden dataset loader**

```typescript
// src/dataset/golden-loader.test.ts
import { describe, it, expect } from 'vitest';
import { loadGoldenDataset, goldenToLlmTests } from './golden-loader.js';

describe('loadGoldenDataset', () => {
  it('parses JSON array format', () => {
    const json = JSON.stringify([
      { input: 'What is ES|QL?', golden_output: 'ES|QL is a query language...' },
      { input: 'Write a FROM query', golden_output: 'FROM logs-*' },
    ]);
    const dataset = loadGoldenDataset(json, 'json');
    expect(dataset).toHaveLength(2);
    expect(dataset[0].input).toBe('What is ES|QL?');
    expect(dataset[0].goldenOutput).toBe('ES|QL is a query language...');
  });

  it('parses JSONL format', () => {
    const jsonl = [
      '{"input": "query 1", "golden_output": "answer 1"}',
      '{"input": "query 2", "golden_output": "answer 2"}',
    ].join('\n');
    const dataset = loadGoldenDataset(jsonl, 'jsonl');
    expect(dataset).toHaveLength(2);
    expect(dataset[1].input).toBe('query 2');
  });
});

describe('goldenToLlmTests', () => {
  it('generates LLM test configs from golden entries', () => {
    const entries = [
      { input: 'What is ES|QL?', goldenOutput: 'ES|QL is a query language...' },
    ];
    const tests = goldenToLlmTests(entries, { evaluators: ['correctness', 'similarity'] });
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe('golden-0-what-is-esql');
    expect(tests[0].prompt).toBe('What is ES|QL?');
    expect(tests[0].expected.responseContains).toEqual(['ES|QL is a query language...']);
    expect(tests[0].evaluators).toEqual(['correctness', 'similarity']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/dataset/golden-loader.test.ts`
Expected: FAIL — cannot resolve `./golden-loader.js`

- [ ] **Step 3: Implement golden-loader.ts**

```typescript
// src/dataset/golden-loader.ts
import type { LlmTestConfig } from '../core/types.js';

export interface GoldenEntry {
  input: string;
  goldenOutput: string;
}

interface RawGoldenEntry {
  input: string;
  golden_output: string;
}

export function loadGoldenDataset(content: string, format: 'json' | 'jsonl'): GoldenEntry[] {
  if (format === 'jsonl') {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const raw = JSON.parse(line) as RawGoldenEntry;
        return { input: raw.input, goldenOutput: raw.golden_output };
      });
  }

  const raw = JSON.parse(content) as RawGoldenEntry[];
  return raw.map((r) => ({ input: r.input, goldenOutput: r.golden_output }));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

export function goldenToLlmTests(
  entries: GoldenEntry[],
  options: { evaluators?: string[] } = {},
): LlmTestConfig[] {
  const evaluators = options.evaluators ?? ['correctness'];

  return entries.map((entry, i) => ({
    name: `golden-${i}-${slugify(entry.input)}`,
    prompt: entry.input,
    expected: {
      responseContains: [entry.goldenOutput],
    },
    evaluators,
  }));
}

export function loadGoldenDatasetFromFile(filePath: string): GoldenEntry[] {
  const { readFileSync } = require('fs');
  const content = readFileSync(filePath, 'utf-8');
  const format = filePath.endsWith('.jsonl') ? 'jsonl' : 'json';
  return loadGoldenDataset(content, format);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/dataset/golden-loader.test.ts`
Expected: PASS

- [ ] **Step 5: Add golden_dataset to config schema**

In `src/core/config.ts`, find the `SuiteSchema` and add `golden_dataset` as an optional field:

```typescript
  golden_dataset: z.string().optional(),
  golden_evaluators: z.array(z.string()).optional(),
```

These are optional fields on the suite config that point to a `.json` or `.jsonl` file path.

- [ ] **Step 6: Commit**

```bash
git add src/dataset/golden-loader.ts src/dataset/golden-loader.test.ts src/core/config.ts
git commit -m "feat: add golden dataset loader for accuracy evaluation"
```

---

### Task 5: Ablation / Baseline Comparison Mode

**Files:**
- Create: `src/ablation/runner.ts`
- Create: `src/ablation/runner.test.ts`
- Modify: `src/cli/main.ts` (add `ablation` command)

**Context:** The RFC's "LLM Baseline" section proposes testing with/without skill to prove the skill adds value. We use the existing Welch's t-test from `src/regression/detector.ts` to compare the two runs.

- [ ] **Step 1: Write the failing test**

```typescript
// src/ablation/runner.test.ts
import { describe, it, expect } from 'vitest';
import { computeAblation } from './runner.js';
import type { RunResult } from '../core/types.js';

function makeRunResult(passRate: number, scores: number[]): RunResult {
  return {
    runId: 'test',
    timestamp: new Date().toISOString(),
    config: 'test',
    suites: [{
      name: 'test-suite',
      layer: 'llm',
      tests: scores.map((s, i) => ({
        name: `test-${i}`,
        suite: 'test-suite',
        layer: 'llm' as const,
        pass: s >= 0.5,
        toolCalls: [],
        evaluatorResults: [{ evaluator: 'correctness', score: s, pass: s >= 0.5 }],
        latencyMs: 100,
      })),
      passRate,
      duration: 1000,
      evaluatorSummary: {},
    }],
    overall: { total: scores.length, passed: Math.round(passRate * scores.length), failed: Math.round((1 - passRate) * scores.length), skipped: 0, passRate, duration: 1000 },
  };
}

describe('computeAblation', () => {
  it('detects improvement when skill run scores higher', () => {
    const withSkill = makeRunResult(0.9, [0.9, 0.85, 0.95, 0.88, 0.92]);
    const withoutSkill = makeRunResult(0.4, [0.4, 0.35, 0.45, 0.38, 0.42]);

    const result = computeAblation(withSkill, withoutSkill);
    expect(result.skillHelps).toBe(true);
    expect(result.delta).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it('detects no improvement when scores are similar', () => {
    const withSkill = makeRunResult(0.5, [0.5, 0.52, 0.48, 0.51, 0.49]);
    const withoutSkill = makeRunResult(0.5, [0.5, 0.51, 0.49, 0.5, 0.50]);

    const result = computeAblation(withSkill, withoutSkill);
    expect(result.skillHelps).toBe(false);
    expect(result.pValue).toBeGreaterThan(0.05);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/ablation/runner.test.ts`
Expected: FAIL — cannot resolve `./runner.js`

- [ ] **Step 3: Implement ablation runner**

```typescript
// src/ablation/runner.ts
import { welchTTest } from '../regression/detector.js';
import type { RunResult } from '../core/types.js';

export interface AblationResult {
  skillHelps: boolean;
  delta: number;
  withSkillMean: number;
  withoutSkillMean: number;
  pValue: number;
  summary: string;
}

function extractScores(run: RunResult): number[] {
  const scores: number[] = [];
  for (const suite of run.suites) {
    for (const test of suite.tests) {
      if (test.evaluatorResults.length > 0) {
        const avg = test.evaluatorResults.reduce((s, e) => s + e.score, 0) / test.evaluatorResults.length;
        scores.push(avg);
      } else {
        scores.push(test.pass ? 1 : 0);
      }
    }
  }
  return scores;
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function computeAblation(withSkill: RunResult, withoutSkill: RunResult): AblationResult {
  const skillScores = extractScores(withSkill);
  const baselineScores = extractScores(withoutSkill);

  const skillMean = mean(skillScores);
  const baselineMean = mean(baselineScores);
  const delta = skillMean - baselineMean;

  let pValue = 1;
  if (skillScores.length >= 2 && baselineScores.length >= 2) {
    const test = welchTTest(skillScores, baselineScores);
    pValue = test.pValue;
  }

  const skillHelps = delta > 0 && pValue < 0.05;

  const direction = delta > 0 ? 'improved' : delta < 0 ? 'degraded' : 'unchanged';
  const significance = pValue < 0.05 ? 'statistically significant' : 'not statistically significant';
  const summary = `Skill ${direction} scores by ${(Math.abs(delta) * 100).toFixed(1)} percentage points (p=${pValue.toFixed(4)}, ${significance}). With skill: ${(skillMean * 100).toFixed(1)}%, Without: ${(baselineMean * 100).toFixed(1)}%.`;

  return { skillHelps, delta, withSkillMean: skillMean, withoutSkillMean: baselineMean, pValue, summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/ablation/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ablation/runner.ts src/ablation/runner.test.ts
git commit -m "feat: add ablation runner for skill-vs-baseline comparison"
```

---

### Task 6: Update Documentation

**Files:**
- Modify: `docs/evaluators.md`
- Modify: `docs/configuration.md`
- Modify: `docs/layers/skill.md`
- Create: `docs/trial-metrics.md`
- Create: `docs/ablation.md`
- Modify: `docs/_sidebar.md`

- [ ] **Step 1: Add trial-metrics.md**

```markdown
# Trial Metrics: pass@k and pass^k

When running evaluations with multiple repetitions (`repetitions: N` or `--repeat N`), the framework computes probabilistic trial metrics based on [Anthropic's agent evaluation methodology](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

## Metrics

- **Per-trial success rate (p):** The average probability that a single test passes on any given trial.
- **pass@k:** `1 - (1-p)^k` — the probability that at least one of k trials succeeds. Increases with k.
- **pass^k:** `p^k` — the probability that all k trials succeed. Decreases with k.

At k=1, both metrics equal p. As k grows, pass@k approaches 100% while pass^k approaches 0%.

## Named Presets

Use `--preset` for standard trial counts:

| Preset | Trials | Use Case |
|--------|--------|----------|
| `--preset smoke` | 5 | Fast feedback during development |
| `--preset reliable` | 20 | Balanced CI validation |
| `--preset regression` | 50 | Comprehensive pre-release |

## Example Output

```
  Trial Metrics

  Per-trial success rate: 85.0%

  k   pass@k   pass^k
  1   85.0%    85.0%
  5   99.9%    44.4%
  10  100.0%   19.7%
```

## Configuration

```yaml
defaults:
  repetitions: 5
```

Or via CLI: `--repeat 20` or `--preset reliable`.
```

- [ ] **Step 2: Add ablation.md**

```markdown
# Ablation Testing

Ablation testing proves that a skill adds value by running the same prompts **with and without** the skill, then comparing results using a Welch's t-test for statistical significance.

## How It Works

1. Run evaluation with the skill enabled (normal mode)
2. Run evaluation without the skill (baseline)
3. Extract per-test scores from both runs
4. Apply Welch's t-test to determine if the difference is statistically significant (p < 0.05)

## Interpreting Results

```
Skill improved scores by 35.2 percentage points (p=0.0012, statistically significant).
With skill: 87.3%, Without: 52.1%.
```

- **delta > 0 and p < 0.05:** The skill measurably helps
- **delta ≈ 0 or p > 0.05:** No evidence the skill adds value
- **delta < 0 and p < 0.05:** The skill makes things worse

## API Usage

```typescript
import { computeAblation } from 'cursor-plugin-evals';

const result = computeAblation(withSkillRun, withoutSkillRun);
console.log(result.summary);
```
```

- [ ] **Step 3: Update docs/evaluators.md**

Add a section for the `script` evaluator:

```markdown
### script

**Kind:** CODE

Runs an arbitrary shell command and parses JSON output. Ideal for quick deterministic checks like file existence, keyword grep, or structural validation.

**Config:**
```yaml
evaluators:
  - script

# In test config:
config:
  run: |
    score=0
    if grep -qi "FROM.*logs" output.esql; then score=$((score+1)); fi
    if grep -qi "LIMIT" output.esql; then score=$((score+1)); fi
    echo "{\"score\": $(echo "scale=2; $score/2" | bc)}"
  threshold: 0.8
```

**Environment variables available to script:**
- `EVAL_OUTPUT` — the agent's final output
- `EVAL_PROMPT` — the original prompt
- `EVAL_TEST_NAME` — the test name

**Expected JSON output:** `{"score": 0.0-1.0, "label": "optional", "explanation": "optional"}`
```

- [ ] **Step 4: Update docs/configuration.md with golden_dataset and presets**

Add to the "Suites" section:

```markdown
#### Golden Dataset

Point a suite at a file of input/golden-output pairs for accuracy testing:

```yaml
suites:
  - name: accuracy-check
    layer: llm
    golden_dataset: datasets/esql-golden.jsonl
    golden_evaluators:
      - correctness
      - similarity
```

File format (`.jsonl`):
```jsonl
{"input": "Count all logs", "golden_output": "FROM logs-* | STATS count = COUNT(*)"}
{"input": "Show recent errors", "golden_output": "FROM logs-* | WHERE level == \"error\" | SORT @timestamp DESC | LIMIT 10"}
```
```

Add to the "CLI Reference" section:

```markdown
#### Trial Presets

```bash
cursor-plugin-evals run --preset smoke       # 5 repetitions
cursor-plugin-evals run --preset reliable    # 20 repetitions
cursor-plugin-evals run --preset regression  # 50 repetitions
```

Presets are equivalent to `--repeat N` and can be overridden by `--repeat`.
```

- [ ] **Step 5: Update docs/_sidebar.md navigation**

Add entries:

```markdown
  - [Trial Metrics](trial-metrics.md)
  - [Ablation Testing](ablation.md)
```

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs: add trial metrics, ablation testing, script evaluator, golden datasets"
```

---

### Task 7: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update feature badges**

Find the existing feature badge counts and update:
- Evaluators count: increment by 1 (for `script`)
- Add "pass@k/pass^k metrics" to the features list
- Add "Ablation testing" to the features list

- [ ] **Step 2: Add a "Probabilistic Metrics" section**

After the existing features section, add:

```markdown
### Probabilistic Trial Metrics

Run evaluations multiple times and compute industry-standard metrics:

```bash
# Named presets for common trial counts
npx cursor-plugin-evals run --preset smoke       # 5 trials
npx cursor-plugin-evals run --preset reliable    # 20 trials
npx cursor-plugin-evals run --preset regression  # 50 trials
```

Output includes **pass@k** (at least 1 success in k trials) and **pass^k** (all k trials succeed) — the standard metrics from [Anthropic's agent eval methodology](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
```

- [ ] **Step 3: Add inline script evaluator to the evaluator list**

In the evaluators table/list, add:

```markdown
| `script` | CODE | Run inline bash scripts as graders — output `{"score": 0.75}` |
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README with trial metrics, script evaluator, ablation"
```

---

### Task 8: Update Landing Page

**Files:**
- Modify: `site/index.html`

- [ ] **Step 1: Update badge numbers**

Find the evaluator count badge and increment by 1 (for `script` evaluator).

- [ ] **Step 2: Add feature cards**

In the features grid, add two new cards:

```html
<div class="feature-card">
  <div class="feature-icon">📊</div>
  <h3>pass@k / pass^k Metrics</h3>
  <p>Industry-standard probabilistic metrics from Anthropic's agent eval methodology. Named presets for smoke, reliable, and regression testing.</p>
</div>
<div class="feature-card">
  <div class="feature-icon">🔬</div>
  <h3>Ablation Testing</h3>
  <p>Prove your skill adds value with statistical A/B comparison using Welch's t-test.</p>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add site/index.html
git commit -m "docs: update landing page with new features"
```

---

### Task 9: Run Full Test Suite & Typecheck

**Files:** None (validation only)

- [ ] **Step 1: Run typecheck**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 3: Run lint**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx eslint src/`
Expected: 0 errors

- [ ] **Step 4: Fix any issues found in steps 1-3 and commit**

```bash
git add -A
git commit -m "fix: address typecheck/lint issues from new features"
```

---

### Task 10: Final Commit & Push

- [ ] **Step 1: Create final consolidated commit if needed**

Review all changes with `git log --oneline` to confirm commit history is clean.

- [ ] **Step 2: Push**

```bash
git push origin main
```
