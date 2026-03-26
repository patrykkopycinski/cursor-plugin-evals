# Zero-Config Skill Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let skill authors run `skill-eval init --skill-dir ./my-skill` to auto-generate a complete eval.yaml from SKILL.md, then get actionable recommendations after every run, with `--optimize` to auto-apply improvements.

**Architecture:** Five new modules in `src/skill-init/`: analyzer (LLM extracts skill profile from SKILL.md), generator (LLM produces tests + evaluator selection), writer (serializes to commented YAML), recommendations (deterministic rules + LLM analysis), and optimizer (applies patches to eval.yaml). CLI wiring extends the existing `skill-eval` command in `src/cli/main.ts`. Terminal reporter gets a `printRecommendations()` section. All LLM calls use the existing `callJudge()` from `src/evaluators/llm-judge.ts` with structured JSON prompts.

**Tech Stack:** TypeScript, Vitest, yaml (serialization), callJudge (LLM), Commander (CLI)

---

### Task 1: Skill Analyzer — Types and LLM Extraction

**Files:**
- Create: `src/skill-init/analyzer.ts`
- Create: `src/skill-init/analyzer.test.ts`

**Context:** Reads SKILL.md content, calls LLM to extract a structured `SkillProfile`. Uses `callJudge()` from `src/evaluators/llm-judge.ts` with a system prompt requesting JSON output.

- [ ] **Step 1: Write the failing test**

```typescript
// src/skill-init/analyzer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { analyzeSkill, type SkillProfile } from './analyzer.js';

// Mock callJudge to return a canned SkillProfile
vi.mock('../evaluators/llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 1,
    label: 'OK',
    explanation: JSON.stringify({
      name: 'elasticsearch-esql',
      purpose: 'Generate ES|QL queries from natural language',
      capabilities: ['generate ES|QL queries', 'explain query results'],
      expectedTools: ['esql_query'],
      keyDomainTerms: ['FROM', 'WHERE', 'STATS', 'SORT', 'LIMIT', 'KEEP', 'EVAL'],
      complexity: 'moderate',
      hasCodeOutput: true,
      hasFileOutput: false,
    }),
  }),
}));

describe('analyzeSkill', () => {
  it('extracts a SkillProfile from SKILL.md content', async () => {
    const skillContent = `# ES|QL Skill\n\nThis skill helps users write ES|QL queries...`;
    const profile = await analyzeSkill(skillContent);

    expect(profile.name).toBe('elasticsearch-esql');
    expect(profile.purpose).toBeTruthy();
    expect(profile.capabilities.length).toBeGreaterThan(0);
    expect(profile.keyDomainTerms.length).toBeGreaterThan(0);
    expect(profile.complexity).toBe('moderate');
    expect(profile.hasCodeOutput).toBe(true);
  });

  it('throws if SKILL.md content is empty', async () => {
    await expect(analyzeSkill('')).rejects.toThrow('SKILL.md content is empty');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/analyzer.test.ts`
Expected: FAIL — cannot resolve `./analyzer.js`

- [ ] **Step 3: Implement analyzer.ts**

```typescript
// src/skill-init/analyzer.ts
import { callJudge } from '../evaluators/llm-judge.js';

export interface SkillProfile {
  name: string;
  purpose: string;
  capabilities: string[];
  expectedTools: string[];
  keyDomainTerms: string[];
  complexity: 'simple' | 'moderate' | 'complex';
  hasCodeOutput: boolean;
  hasFileOutput: boolean;
}

const ANALYZER_SYSTEM_PROMPT = `You are an expert at analyzing agent skills. Given the content of a SKILL.md file, extract a structured profile. Respond with ONLY a JSON object matching this schema:

{
  "name": "kebab-case skill name",
  "purpose": "one-line description of what the skill does",
  "capabilities": ["what it can do, e.g. 'generate ES|QL queries'"],
  "expectedTools": ["tool names the skill likely invokes, empty array if pure-text"],
  "keyDomainTerms": ["domain-specific keywords that should appear in correct outputs"],
  "complexity": "simple | moderate | complex",
  "hasCodeOutput": true/false,
  "hasFileOutput": true/false
}`;

export async function analyzeSkill(skillContent: string, model?: string): Promise<SkillProfile> {
  if (!skillContent.trim()) {
    throw new Error('SKILL.md content is empty');
  }

  const response = await callJudge({
    systemPrompt: ANALYZER_SYSTEM_PROMPT,
    userPrompt: skillContent,
    model,
  });

  const jsonStr = response.explanation;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse skill profile from LLM response: ${jsonStr.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as SkillProfile;

  // Validate required fields
  if (!parsed.name || !parsed.purpose || !Array.isArray(parsed.capabilities)) {
    throw new Error('LLM returned incomplete skill profile');
  }

  return {
    name: parsed.name,
    purpose: parsed.purpose,
    capabilities: parsed.capabilities ?? [],
    expectedTools: parsed.expectedTools ?? [],
    keyDomainTerms: parsed.keyDomainTerms ?? [],
    complexity: parsed.complexity ?? 'moderate',
    hasCodeOutput: parsed.hasCodeOutput ?? false,
    hasFileOutput: parsed.hasFileOutput ?? false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/analyzer.test.ts`
Expected: PASS

---

### Task 2: Test Generator — LLM-Powered Test Case Generation

**Files:**
- Create: `src/skill-init/generator.ts`
- Create: `src/skill-init/generator.test.ts`

**Context:** Takes a `SkillProfile` and uses LLM to produce 5-8 test cases with auto-selected evaluators and thresholds. Evaluator selection is deterministic (based on profile flags); test generation is LLM-driven.

- [ ] **Step 1: Write the failing test**

```typescript
// src/skill-init/generator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateEval, selectEvaluators, selectThresholds, type GeneratedEval } from './generator.js';
import type { SkillProfile } from './analyzer.js';

const ESQL_PROFILE: SkillProfile = {
  name: 'elasticsearch-esql',
  purpose: 'Generate ES|QL queries from natural language',
  capabilities: ['generate ES|QL queries', 'explain query results'],
  expectedTools: ['esql_query'],
  keyDomainTerms: ['FROM', 'WHERE', 'STATS', 'SORT', 'LIMIT'],
  complexity: 'moderate',
  hasCodeOutput: true,
  hasFileOutput: false,
};

vi.mock('../evaluators/llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 1,
    label: 'OK',
    explanation: JSON.stringify({
      tests: [
        { name: 'basic-from-query', prompt: 'Write a FROM query for logs-*', expected: { response_contains: ['FROM', 'logs-*'] }, difficulty: 'simple', category: 'happy-path' },
        { name: 'count-aggregation', prompt: 'Count all logs', expected: { response_contains: ['STATS', 'COUNT'] }, difficulty: 'simple', category: 'happy-path' },
        { name: 'filtered-query', prompt: 'Show errors from last hour', expected: { response_contains: ['WHERE', 'error'] }, difficulty: 'moderate', category: 'happy-path' },
        { name: 'multi-aggregation', prompt: 'Count by host and level', expected: { response_contains: ['STATS', 'BY'] }, difficulty: 'moderate', category: 'edge-case' },
        { name: 'empty-result-handling', prompt: 'Query a non-existent index', expected: { response_contains: ['FROM'] }, difficulty: 'moderate', category: 'edge-case' },
        { name: 'large-limit', prompt: 'Get 10000 results', expected: { response_contains: ['LIMIT'] }, difficulty: 'simple', category: 'boundary' },
        { name: 'invalid-request', prompt: 'Do something impossible with ES|QL', expected: { response_not_contains: ['DROP TABLE'] }, difficulty: 'complex', category: 'negative' },
      ],
    }),
  }),
}));

describe('selectEvaluators', () => {
  it('always includes correctness', () => {
    const evals = selectEvaluators({ ...ESQL_PROFILE, keyDomainTerms: [], expectedTools: [], hasCodeOutput: false });
    expect(evals).toContain('correctness');
  });

  it('adds keywords when domain terms exist', () => {
    expect(selectEvaluators(ESQL_PROFILE)).toContain('keywords');
  });

  it('adds script when skill produces code', () => {
    expect(selectEvaluators(ESQL_PROFILE)).toContain('script');
  });

  it('adds tool-selection when tools expected', () => {
    expect(selectEvaluators(ESQL_PROFILE)).toContain('tool-selection');
  });

  it('adds plan-quality for complex skills', () => {
    const complex = { ...ESQL_PROFILE, complexity: 'complex' as const };
    expect(selectEvaluators(complex)).toContain('plan-quality');
  });
});

describe('selectThresholds', () => {
  it('returns thresholds for selected evaluators', () => {
    const thresholds = selectThresholds(['correctness', 'keywords', 'script']);
    expect(thresholds.correctness).toBe(0.7);
    expect(thresholds.keywords).toBe(0.6);
    expect(thresholds.script).toBe(0.5);
  });
});

describe('generateEval', () => {
  it('produces a GeneratedEval with tests and evaluators', async () => {
    const result = await generateEval(ESQL_PROFILE);

    expect(result.name).toBe('elasticsearch-esql');
    expect(result.tests.length).toBeGreaterThanOrEqual(5);
    expect(result.evaluators).toContain('correctness');
    expect(result.defaults.thresholds.correctness).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/generator.test.ts`
Expected: FAIL — cannot resolve `./generator.js`

- [ ] **Step 3: Implement generator.ts**

```typescript
// src/skill-init/generator.ts
import { callJudge } from '../evaluators/llm-judge.js';
import type { SkillProfile } from './analyzer.js';

export interface GeneratedTest {
  name: string;
  prompt: string;
  expected: {
    response_contains?: string[];
    response_not_contains?: string[];
    tools?: string[];
  };
  difficulty: 'simple' | 'moderate' | 'complex';
  category: 'happy-path' | 'edge-case' | 'boundary' | 'negative';
}

export interface GeneratedEval {
  name: string;
  description: string;
  evaluators: string[];
  tests: GeneratedTest[];
  defaults: {
    timeout: number;
    repetitions: number;
    thresholds: Record<string, number>;
  };
}

const DEFAULT_THRESHOLDS: Record<string, number> = {
  correctness: 0.7,
  keywords: 0.6,
  script: 0.5,
  'tool-selection': 0.8,
  'plan-quality': 0.6,
};

export function selectEvaluators(profile: SkillProfile): string[] {
  const evals: string[] = ['correctness'];
  if (profile.keyDomainTerms.length > 0) evals.push('keywords');
  if (profile.hasCodeOutput) evals.push('script');
  if (profile.expectedTools.length > 0) evals.push('tool-selection');
  if (profile.complexity === 'complex') evals.push('plan-quality');
  return evals;
}

export function selectThresholds(evaluators: string[]): Record<string, number> {
  const thresholds: Record<string, number> = {};
  for (const name of evaluators) {
    if (DEFAULT_THRESHOLDS[name] !== undefined) {
      thresholds[name] = DEFAULT_THRESHOLDS[name];
    }
  }
  return thresholds;
}

const GENERATOR_SYSTEM_PROMPT = `You are an expert test designer for AI agent skills. Given a skill profile, generate 5-8 diverse test cases. Respond with ONLY a JSON object:

{
  "tests": [
    {
      "name": "kebab-case-test-name",
      "prompt": "The natural language instruction to test",
      "expected": {
        "response_contains": ["keywords that should appear in a correct response"],
        "response_not_contains": ["keywords that should NOT appear (optional)"],
        "tools": ["expected tool names (optional)"]
      },
      "difficulty": "simple | moderate | complex",
      "category": "happy-path | edge-case | boundary | negative"
    }
  ]
}

Distribution: 3 happy-path, 2 edge-case, 1 boundary, 1 negative (minimum 5, max 8).
Make tests realistic and domain-specific. Each test should exercise a different capability.`;

export async function generateEval(profile: SkillProfile, model?: string): Promise<GeneratedEval> {
  const evaluators = selectEvaluators(profile);
  const thresholds = selectThresholds(evaluators);

  const response = await callJudge({
    systemPrompt: GENERATOR_SYSTEM_PROMPT,
    userPrompt: JSON.stringify(profile, null, 2),
    model,
  });

  const jsonMatch = response.explanation.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse generated tests from LLM: ${response.explanation.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as { tests: GeneratedTest[] };
  if (!Array.isArray(parsed.tests) || parsed.tests.length === 0) {
    throw new Error('LLM returned no tests');
  }

  return {
    name: profile.name,
    description: `Evaluates: ${profile.purpose}`,
    evaluators,
    tests: parsed.tests,
    defaults: {
      timeout: 120_000,
      repetitions: 1,
      thresholds,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/generator.test.ts`
Expected: PASS

---

### Task 3: YAML Writer — Serialize GeneratedEval to Commented eval.yaml

**Files:**
- Create: `src/skill-init/writer.ts`
- Create: `src/skill-init/writer.test.ts`

**Context:** Serializes a `GeneratedEval` into a human-friendly YAML string with inline comments. Uses the `yaml` package's `stringify` for the data, then prepends a header comment. Also handles the `--force` / existing-file check.

- [ ] **Step 1: Write the failing test**

```typescript
// src/skill-init/writer.test.ts
import { describe, it, expect } from 'vitest';
import { serializeEvalYaml } from './writer.js';
import type { GeneratedEval } from './generator.js';

const SAMPLE_EVAL: GeneratedEval = {
  name: 'test-skill',
  description: 'Evaluates: test skill',
  evaluators: ['correctness', 'keywords'],
  tests: [
    {
      name: 'basic-test',
      prompt: 'Do something',
      expected: { response_contains: ['result'] },
      difficulty: 'simple',
      category: 'happy-path',
    },
  ],
  defaults: {
    timeout: 120000,
    repetitions: 1,
    thresholds: { correctness: 0.7, keywords: 0.6 },
  },
};

describe('serializeEvalYaml', () => {
  it('produces valid YAML with header comment', () => {
    const yaml = serializeEvalYaml(SAMPLE_EVAL);
    expect(yaml).toContain('# Auto-generated by cursor-plugin-evals');
    expect(yaml).toContain('name: test-skill');
    expect(yaml).toContain('correctness');
    expect(yaml).toContain('basic-test');
  });

  it('includes all tests', () => {
    const yaml = serializeEvalYaml(SAMPLE_EVAL);
    expect(yaml).toContain('prompt: Do something');
    expect(yaml).toContain('result');
  });

  it('includes defaults section', () => {
    const yaml = serializeEvalYaml(SAMPLE_EVAL);
    expect(yaml).toContain('timeout: 120000');
    expect(yaml).toContain('repetitions: 1');
  });

  it('round-trips through YAML parse', () => {
    const { parse } = require('yaml');
    const yaml = serializeEvalYaml(SAMPLE_EVAL);
    const parsed = parse(yaml);
    expect(parsed.name).toBe('test-skill');
    expect(parsed.tests).toHaveLength(1);
    expect(parsed.evaluators).toEqual(['correctness', 'keywords']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/writer.test.ts`
Expected: FAIL — cannot resolve `./writer.js`

- [ ] **Step 3: Implement writer.ts**

```typescript
// src/skill-init/writer.ts
import { stringify } from 'yaml';
import type { GeneratedEval } from './generator.js';

const HEADER = `# Auto-generated by cursor-plugin-evals from SKILL.md
# Edit freely — this file is yours to customize.
# Re-run with --optimize after a test run to get AI-powered improvement suggestions.
`;

export function serializeEvalYaml(generated: GeneratedEval): string {
  const doc = {
    name: generated.name,
    description: generated.description,
    evaluators: generated.evaluators,
    defaults: generated.defaults,
    tests: generated.tests.map((t) => {
      const test: Record<string, unknown> = {
        name: t.name,
        prompt: t.prompt,
        expected: {},
      };

      const expected: Record<string, unknown> = {};
      if (t.expected.response_contains?.length) {
        expected.response_contains = t.expected.response_contains;
      }
      if (t.expected.response_not_contains?.length) {
        expected.response_not_contains = t.expected.response_not_contains;
      }
      if (t.expected.tools?.length) {
        expected.tools = t.expected.tools;
      }
      test.expected = expected;

      return test;
    }),
  };

  const yamlStr = stringify(doc, { lineWidth: 120 });
  return HEADER + yamlStr;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/writer.test.ts`
Expected: PASS

---

### Task 4: Recommendation Engine — Deterministic Rules + LLM Analysis

**Files:**
- Create: `src/skill-init/recommendations.ts`
- Create: `src/skill-init/recommendations.test.ts`

**Context:** Two-phase pipeline. Phase 1 is deterministic rules on RunResult (free, fast). Phase 2 is an LLM call that receives SKILL.md content + RunResult + eval.yaml and produces domain-specific suggestions. Both return the same `Recommendation[]` interface.

- [ ] **Step 1: Write the failing test for deterministic rules**

```typescript
// src/skill-init/recommendations.test.ts
import { describe, it, expect, vi } from 'vitest';
import { computeDeterministicRecommendations, computeLlmRecommendations, type Recommendation } from './recommendations.js';
import type { RunResult, SuiteResult, TestResult } from '../core/types.js';

function makeSuiteResult(tests: TestResult[]): SuiteResult {
  const passCount = tests.filter((t) => t.pass).length;
  return {
    name: 'skill-suite',
    layer: 'skill',
    tests,
    passRate: tests.length > 0 ? passCount / tests.length : 0,
    duration: 1000,
    evaluatorSummary: {},
  };
}

function makeRunResult(tests: TestResult[]): RunResult {
  const suite = makeSuiteResult(tests);
  return {
    runId: 'test',
    timestamp: new Date().toISOString(),
    config: 'test',
    suites: [suite],
    overall: {
      total: tests.length,
      passed: tests.filter((t) => t.pass).length,
      failed: tests.filter((t) => !t.pass).length,
      skipped: 0,
      passRate: suite.passRate,
      duration: 1000,
    },
  };
}

function makeTest(name: string, score: number, evaluator = 'correctness'): TestResult {
  return {
    name,
    suite: 'skill-suite',
    layer: 'skill',
    pass: score >= 0.5,
    toolCalls: [],
    evaluatorResults: [{ evaluator, score, pass: score >= 0.5 }],
    latencyMs: 100,
  };
}

describe('computeDeterministicRecommendations', () => {
  it('recommends repetitions when pass rate is 100% with repetitions=1', () => {
    const result = makeRunResult([makeTest('a', 1.0), makeTest('b', 1.0)]);
    const evalYaml = { defaults: { repetitions: 1 } };
    const recs = computeDeterministicRecommendations(result, evalYaml);
    expect(recs.some((r) => r.message.includes('repetitions'))).toBe(true);
  });

  it('warns when evaluator scores very low', () => {
    const result = makeRunResult([makeTest('a', 0.1), makeTest('b', 0.2)]);
    const recs = computeDeterministicRecommendations(result, {});
    expect(recs.some((r) => r.message.includes('scores very low'))).toBe(true);
  });

  it('suggests more tests when fewer than 5', () => {
    const result = makeRunResult([makeTest('a', 0.8), makeTest('b', 0.9)]);
    const recs = computeDeterministicRecommendations(result, {});
    expect(recs.some((r) => r.message.includes('more tests'))).toBe(true);
  });

  it('suggests harder tests when all score 1.0', () => {
    const tests = Array.from({ length: 6 }, (_, i) => makeTest(`t${i}`, 1.0));
    const result = makeRunResult(tests);
    const recs = computeDeterministicRecommendations(result, {});
    expect(recs.some((r) => r.message.includes('too easy'))).toBe(true);
  });

  it('returns empty array when nothing to recommend', () => {
    const tests = Array.from({ length: 6 }, (_, i) => makeTest(`t${i}`, 0.7 + i * 0.03));
    const result = makeRunResult(tests);
    const evalYaml = { defaults: { repetitions: 5 } };
    const recs = computeDeterministicRecommendations(result, evalYaml);
    // Some may still fire, but no crash
    expect(Array.isArray(recs)).toBe(true);
  });
});

describe('computeLlmRecommendations', () => {
  it('returns recommendations from LLM', async () => {
    vi.mock('../evaluators/llm-judge.js', () => ({
      callJudge: vi.fn().mockResolvedValue({
        score: 1,
        label: 'OK',
        explanation: JSON.stringify({
          recommendations: [
            { type: 'test', priority: 'high', message: 'Add a test for DISSECT pattern' },
          ],
        }),
      }),
    }));

    const result = makeRunResult([makeTest('a', 0.8)]);
    const recs = await computeLlmRecommendations(result, 'skill content', 'eval yaml content');
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].message).toContain('DISSECT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/recommendations.test.ts`
Expected: FAIL — cannot resolve `./recommendations.js`

- [ ] **Step 3: Implement recommendations.ts**

```typescript
// src/skill-init/recommendations.ts
import { callJudge } from '../evaluators/llm-judge.js';
import type { RunResult } from '../core/types.js';

export interface EvalYamlPatch {
  op: 'add_evaluator' | 'remove_evaluator' | 'set_threshold' | 'add_test' | 'set_repetitions';
  path: string;
  value: unknown;
}

export interface Recommendation {
  type: 'evaluator' | 'threshold' | 'test' | 'config';
  priority: 'high' | 'medium' | 'low';
  message: string;
  action?: EvalYamlPatch;
}

export function computeDeterministicRecommendations(
  result: RunResult,
  evalYaml: Record<string, unknown>,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const allTests = result.suites.flatMap((s) => s.tests);

  // All tests pass at 1.0 → too easy
  const allPerfect = allTests.length > 0 && allTests.every((t) =>
    t.evaluatorResults.length > 0 && t.evaluatorResults.every((er) => er.score >= 1.0),
  );
  if (allPerfect) {
    recs.push({
      type: 'test',
      priority: 'medium',
      message: 'All tests score 1.0 — tests may be too easy. Consider adding harder edge cases.',
    });
  }

  // Per-evaluator average check
  const evalScores = new Map<string, number[]>();
  for (const t of allTests) {
    for (const er of t.evaluatorResults) {
      const arr = evalScores.get(er.evaluator) ?? [];
      arr.push(er.score);
      evalScores.set(er.evaluator, arr);
    }
  }
  for (const [name, scores] of evalScores) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg < 0.3) {
      recs.push({
        type: 'threshold',
        priority: 'high',
        message: `Evaluator "${name}" scores very low (avg ${(avg * 100).toFixed(0)}%). Consider lowering the threshold or improving the skill.`,
        action: { op: 'set_threshold', path: `defaults.thresholds.${name}`, value: Math.max(0.2, avg - 0.1) },
      });
    }
  }

  // 100% pass rate with repetitions=1 → add repetitions
  const defaults = evalYaml.defaults as Record<string, unknown> | undefined;
  const reps = (defaults?.repetitions as number | undefined) ?? 1;
  if (result.overall.passRate === 1 && reps <= 1) {
    recs.push({
      type: 'config',
      priority: 'medium',
      message: 'All tests pass with 1 repetition. Add `repetitions: 5` to measure consistency and enable pass@k metrics.',
      action: { op: 'set_repetitions', path: 'defaults.repetitions', value: 5 },
    });
  }

  // Fewer than 5 tests
  if (allTests.length < 5) {
    recs.push({
      type: 'test',
      priority: 'high',
      message: `Only ${allTests.length} tests — add more tests for better coverage (aim for 5-8).`,
    });
  }

  return recs;
}

const RECOMMENDER_SYSTEM_PROMPT = `You are an expert at improving AI skill evaluations. Given:
1. The SKILL.md content (what the skill does)
2. The eval run results (which tests passed/failed and scores)
3. The current eval.yaml (test definitions)

Suggest 2-4 specific, actionable improvements. Respond with ONLY a JSON object:

{
  "recommendations": [
    {
      "type": "evaluator | threshold | test | config",
      "priority": "high | medium | low",
      "message": "Specific, actionable recommendation with concrete details"
    }
  ]
}

Focus on: coverage gaps, test quality, missing evaluators, threshold tuning, and concrete new test ideas with prompts.`;

export async function computeLlmRecommendations(
  result: RunResult,
  skillContent: string,
  evalYamlContent: string,
  model?: string,
): Promise<Recommendation[]> {
  const testSummary = result.suites.flatMap((s) =>
    s.tests.map((t) => ({
      name: t.name,
      pass: t.pass,
      scores: Object.fromEntries(t.evaluatorResults.map((er) => [er.evaluator, er.score])),
    })),
  );

  const userPrompt = [
    '## SKILL.md',
    skillContent.slice(0, 3000),
    '',
    '## Run Results',
    JSON.stringify({ passRate: result.overall.passRate, tests: testSummary }, null, 2),
    '',
    '## Current eval.yaml',
    evalYamlContent.slice(0, 3000),
  ].join('\n');

  try {
    const response = await callJudge({
      systemPrompt: RECOMMENDER_SYSTEM_PROMPT,
      userPrompt,
      model,
    });

    const jsonMatch = response.explanation.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as { recommendations: Recommendation[] };
    return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/recommendations.test.ts`
Expected: PASS

---

### Task 5: Optimizer — Apply Recommendation Patches to eval.yaml

**Files:**
- Create: `src/skill-init/optimizer.ts`
- Create: `src/skill-init/optimizer.test.ts`

**Context:** Reads eval.yaml, applies `EvalYamlPatch[]` from recommendations, writes back. Handles `set_threshold`, `set_repetitions`, `add_evaluator`, `remove_evaluator`. `add_test` patches are logged but not auto-applied (too complex to serialize reliably).

- [ ] **Step 1: Write the failing test**

```typescript
// src/skill-init/optimizer.test.ts
import { describe, it, expect } from 'vitest';
import { applyPatches } from './optimizer.js';
import type { EvalYamlPatch } from './recommendations.js';

describe('applyPatches', () => {
  it('sets a threshold value', () => {
    const yaml = { defaults: { thresholds: { correctness: 0.7 } } };
    const patches: EvalYamlPatch[] = [
      { op: 'set_threshold', path: 'defaults.thresholds.correctness', value: 0.5 },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.defaults.thresholds.correctness).toBe(0.5);
  });

  it('sets repetitions', () => {
    const yaml = { defaults: { repetitions: 1 } };
    const patches: EvalYamlPatch[] = [
      { op: 'set_repetitions', path: 'defaults.repetitions', value: 5 },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.defaults.repetitions).toBe(5);
  });

  it('adds an evaluator', () => {
    const yaml = { evaluators: ['correctness'] };
    const patches: EvalYamlPatch[] = [
      { op: 'add_evaluator', path: 'evaluators', value: 'keywords' },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.evaluators).toContain('keywords');
  });

  it('does not duplicate evaluators', () => {
    const yaml = { evaluators: ['correctness', 'keywords'] };
    const patches: EvalYamlPatch[] = [
      { op: 'add_evaluator', path: 'evaluators', value: 'keywords' },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.evaluators.filter((e: string) => e === 'keywords')).toHaveLength(1);
  });

  it('removes an evaluator', () => {
    const yaml = { evaluators: ['correctness', 'keywords'] };
    const patches: EvalYamlPatch[] = [
      { op: 'remove_evaluator', path: 'evaluators', value: 'keywords' },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.evaluators).not.toContain('keywords');
  });

  it('handles missing intermediate paths gracefully', () => {
    const yaml = {};
    const patches: EvalYamlPatch[] = [
      { op: 'set_threshold', path: 'defaults.thresholds.correctness', value: 0.6 },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.defaults.thresholds.correctness).toBe(0.6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/optimizer.test.ts`
Expected: FAIL — cannot resolve `./optimizer.js`

- [ ] **Step 3: Implement optimizer.ts**

```typescript
// src/skill-init/optimizer.ts
import type { EvalYamlPatch } from './recommendations.js';

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export function applyPatches(
  yaml: Record<string, unknown>,
  patches: EvalYamlPatch[],
): Record<string, unknown> {
  const result = structuredClone(yaml);

  for (const patch of patches) {
    switch (patch.op) {
      case 'set_threshold':
      case 'set_repetitions':
        setNestedValue(result, patch.path, patch.value);
        break;

      case 'add_evaluator': {
        if (!Array.isArray(result.evaluators)) result.evaluators = [];
        const evals = result.evaluators as string[];
        if (!evals.includes(patch.value as string)) {
          evals.push(patch.value as string);
        }
        break;
      }

      case 'remove_evaluator': {
        if (Array.isArray(result.evaluators)) {
          result.evaluators = (result.evaluators as string[]).filter(
            (e) => e !== patch.value,
          );
        }
        break;
      }

      case 'add_test':
        // Log-only: too complex to serialize automatically
        break;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/optimizer.test.ts`
Expected: PASS

---

### Task 6: Terminal Reporter — Print Recommendations

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/reporting/terminal.ts`

**Context:** Add `recommendations` field to `RunResult`, add `printRecommendations()` to terminal reporter.

- [ ] **Step 1: Add recommendations field to RunResult in types.ts**

In `src/core/types.ts`, in the `RunResult` interface, add after `trialMetrics` (line 101):

```typescript
  recommendations?: Array<{ type: string; priority: string; message: string }>;
```

This is a lightweight inline type so `types.ts` doesn't depend on `skill-init/`. The full `Recommendation` interface with `action` lives in `src/skill-init/recommendations.ts`.

- [ ] **Step 2: Add printRecommendations to terminal.ts**

In `src/reporting/terminal.ts`, add before `printTerminalReport`:

```typescript
function printRecommendations(recommendations: import('../core/types.js').Recommendation[]): void {
  if (recommendations.length === 0) return;

  log.divider();
  log.info(chalk.bold('  Recommendations'));
  log.info('');

  const priorityIcon = { high: chalk.red('●'), medium: chalk.yellow('●'), low: chalk.dim('●') };

  for (const rec of recommendations.slice(0, 5)) {
    const icon = priorityIcon[rec.priority] ?? chalk.dim('●');
    log.info(`  ${icon} ${rec.message}`);
  }
  log.info('');
}
```

- [ ] **Step 3: Call printRecommendations in printTerminalReport**

In `printTerminalReport`, add after the `trialMetrics` block (around line 212):

```typescript
  if (result.recommendations?.length) {
    printRecommendations(result.recommendations);
  }
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx tsc --noEmit`
Expected: 0 errors

---

### Task 7: CLI Wiring — `skill-eval init` and `--optimize`

**Files:**
- Create: `src/skill-init/index.ts`
- Modify: `src/cli/main.ts`

**Context:** Barrel export for the skill-init module, plus CLI wiring. `init` subcommand reads SKILL.md, calls analyzer → generator → writer. `--optimize` flag on existing `skill-eval` runs recommendations after eval, then applies patches.

- [ ] **Step 1: Create barrel export**

```typescript
// src/skill-init/index.ts
export { analyzeSkill, type SkillProfile } from './analyzer.js';
export { generateEval, selectEvaluators, selectThresholds, type GeneratedEval, type GeneratedTest } from './generator.js';
export { serializeEvalYaml } from './writer.js';
export {
  computeDeterministicRecommendations,
  computeLlmRecommendations,
  type Recommendation,
  type EvalYamlPatch,
} from './recommendations.js';
export { applyPatches } from './optimizer.js';
```

- [ ] **Step 2: Add `skill-eval init` subcommand to main.ts**

In `src/cli/main.ts`, find the `.command('skill-eval')` block (line 946). Before its `.action()`, add a subcommand. Since Commander doesn't easily support subcommands on existing commands, we'll add a new top-level command `skill-eval-init`:

After the `skill-eval` command block (after line 1087), add:

```typescript
program
  .command('skill-eval-init')
  .description('Auto-generate eval.yaml from SKILL.md using LLM analysis')
  .requiredOption('--skill-dir <path>', 'directory containing SKILL.md')
  .option('--force', 'overwrite existing eval.yaml')
  .option('-m, --model <model>', 'LLM model for generation')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      skillDir: string;
      force?: boolean;
      model?: string;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      const { resolve } = await import('path');
      const { existsSync, readFileSync, writeFileSync } = await import('fs');

      const skillDir = resolve(process.cwd(), opts.skillDir);
      const skillMdPath = resolve(skillDir, 'SKILL.md');
      const evalYamlPath = resolve(skillDir, 'eval.yaml');

      if (!existsSync(skillMdPath)) {
        log.error(`No SKILL.md found in ${skillDir}. Create a SKILL.md first, then run init again.`);
        process.exitCode = EXIT_CONFIG_ERROR;
        return;
      }

      if (existsSync(evalYamlPath) && !opts.force) {
        log.error(`eval.yaml already exists in ${skillDir}. Use --force to overwrite.`);
        process.exitCode = EXIT_CONFIG_ERROR;
        return;
      }

      log.header('Skill Eval Init');

      try {
        const { analyzeSkill } = await import('../skill-init/analyzer.js');
        const { generateEval } = await import('../skill-init/generator.js');
        const { serializeEvalYaml } = await import('../skill-init/writer.js');

        log.info('  Analyzing SKILL.md...');
        const skillContent = readFileSync(skillMdPath, 'utf-8');
        const profile = await analyzeSkill(skillContent, opts.model);
        log.info(`  Profile: ${profile.name} (${profile.complexity}, ${profile.capabilities.length} capabilities)`);

        log.info('  Generating tests...');
        const generated = await generateEval(profile, opts.model);
        log.info(`  Generated ${generated.tests.length} tests with evaluators: ${generated.evaluators.join(', ')}`);

        const yaml = serializeEvalYaml(generated);
        writeFileSync(evalYamlPath, yaml, 'utf-8');
        log.success(`eval.yaml written to ${evalYamlPath}`);
        log.info('');
        log.info(`  Run: cursor-plugin-evals skill-eval --skill-dir ${opts.skillDir}`);
      } catch (err) {
        log.error('Init failed', err);
        process.exitCode = EXIT_FAIL;
      }
    },
  );
```

- [ ] **Step 3: Add `--optimize` and `--no-llm-recommendations` flags to existing skill-eval command**

In the existing `skill-eval` command (line 946), add two new options after line 958:

```typescript
  .option('--optimize', 'apply AI recommendations to eval.yaml after run')
  .option('--no-llm-recommendations', 'skip LLM-powered recommendations (deterministic only)')
```

Update the action's opts type to include:

```typescript
      optimize?: boolean;
      llmRecommendations?: boolean; // Commander converts --no-llm-recommendations to llmRecommendations: false
```

Then after the `formatReport` call (around line 1074), add the recommendations logic:

```typescript
        // --- Recommendations ---
        const { computeDeterministicRecommendations, computeLlmRecommendations } =
          await import('../skill-init/recommendations.js');
        const { parse: parseYaml } = await import('yaml');

        const evalYamlPath = resolve(skillDir, 'eval.yaml');
        const evalYamlContent = existsSync(evalYamlPath) ? readFileSync(evalYamlPath, 'utf-8') : '';
        const evalYamlParsed = evalYamlContent ? parseYaml(evalYamlContent) : {};

        let allRecs = computeDeterministicRecommendations(result, evalYamlParsed);

        if (opts.llmRecommendations !== false) {
          const skillMdPath = resolve(skillDir, 'SKILL.md');
          const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, 'utf-8') : '';
          if (skillContent) {
            const llmRecs = await computeLlmRecommendations(result, skillContent, evalYamlContent);
            allRecs = [...allRecs, ...llmRecs];
          }
        }

        if (allRecs.length > 0) {
          result.recommendations = allRecs;
          const { printRecommendations } = await import('../reporting/terminal.js');
          if (typeof printRecommendations === 'function') {
            printRecommendations(allRecs);
          }
        }

        // --- Optimize ---
        if (opts.optimize && allRecs.length > 0) {
          const actionableRecs = allRecs.filter((r) => r.action);
          if (actionableRecs.length > 0 && evalYamlContent) {
            const { applyPatches } = await import('../skill-init/optimizer.js');
            const { stringify } = await import('yaml');
            const patched = applyPatches(evalYamlParsed, actionableRecs.map((r) => r.action!));
            const header = evalYamlContent.match(/^(#[^\n]*\n)*/)?.[0] ?? '';
            writeFileSync(evalYamlPath, header + stringify(patched, { lineWidth: 120 }), 'utf-8');
            log.success(`Applied ${actionableRecs.length} optimization(s) to eval.yaml`);
          }
        }
```

- [ ] **Step 4: Export printRecommendations from terminal.ts**

Make `printRecommendations` a named export in `src/reporting/terminal.ts` by changing `function printRecommendations` to `export function printRecommendations`.

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx tsc --noEmit`
Expected: 0 errors

---

### Task 8: Full Test Suite Validation

**Files:** None (validation only)

- [ ] **Step 1: Run all new tests**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/skill-init/`
Expected: All tests pass

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Fix any issues found**

---

### Task 9: Commit All Changes

- [ ] **Step 1: Stage and commit**

```bash
git add src/skill-init/ src/core/types.ts src/reporting/terminal.ts src/cli/main.ts
git commit -m "feat: add zero-config skill eval with auto-generation and AI recommendations

- skill-eval-init: auto-generate eval.yaml from SKILL.md via LLM analysis
- Skill analyzer extracts structured profile from skill content
- Test generator produces 5-8 diverse tests with auto-selected evaluators
- Two-phase recommendation engine (deterministic + LLM-powered)
- --optimize flag applies recommendations to eval.yaml automatically
- Recommendations printed in terminal report after every skill-eval run"
```
