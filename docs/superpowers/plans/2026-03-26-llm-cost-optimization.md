# LLM Cost Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce LLM evaluation costs by 50-80% through caching, per-evaluator model selection, judge call deduplication, configurable multi-judge tiers, judge fixture recording, and cost estimation before runs.

**Architecture:** The core change is wiring the existing `LlmCache` into `callJudge()` so re-runs are near-free. On top of that: (1) `callJudge` gains `options.cache` and `options.model` passthrough so evaluators can specify cheaper models, (2) a deduplication layer batches identical judge prompts within a test, (3) multi-judge gets preset tiers (fast/balanced/thorough), (4) judge responses can be recorded/replayed like MCP fixtures, (5) a `--estimate-cost` flag predicts cost without executing. All features are opt-in and backward-compatible.

**Tech Stack:** TypeScript, Vitest, LlmCache (existing), callJudge (existing), Commander (CLI)

---

### Task 1: Wire LLM Cache into callJudge

**Files:**
- Modify: `src/evaluators/llm-judge.ts`
- Create: `src/evaluators/llm-judge-cache.test.ts`

**Context:** `LlmCache` at `src/cache/index.ts` already implements SHA-256 keyed get/set with TTL. `callJudge` currently makes a live API call every time. We add an optional `cache` parameter to `JudgeRequest` and check the cache before calling the API. Cache is enabled by default but can be disabled via `JUDGE_CACHE=false` env var or per-request.

- [ ] **Step 1: Write the failing test**

```typescript
// src/evaluators/llm-judge-cache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock bedrock to return null (not using bedrock)
vi.mock('../adapters/bedrock.js', () => ({
  getBedrockConfig: () => null,
  signBedrockRequest: vi.fn(),
  buildBedrockBody: vi.fn(),
  parseBedrockResponse: vi.fn(),
}));

import { callJudge, getJudgeCache } from './llm-judge.js';

describe('callJudge caching', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('JUDGE_CACHE', 'true');
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"score": 0.9, "label": "CORRECT", "explanation": "good"}' } }],
        }),
    });
  });

  it('returns cached response on second call with same inputs', async () => {
    const req = { systemPrompt: 'Judge this', userPrompt: 'test input' };

    const first = await callJudge(req);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first.score).toBeCloseTo(0.9);

    const second = await callJudge(req);
    expect(mockFetch).toHaveBeenCalledTimes(1); // no additional fetch
    expect(second.score).toBeCloseTo(0.9);
  });

  it('makes a new call when inputs differ', async () => {
    await callJudge({ systemPrompt: 'A', userPrompt: 'B' });
    await callJudge({ systemPrompt: 'A', userPrompt: 'C' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('skips cache when cache option is false', async () => {
    const req = { systemPrompt: 'Judge', userPrompt: 'input', cache: false };
    await callJudge(req);
    await callJudge(req);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('skips cache when JUDGE_CACHE env is false', async () => {
    vi.stubEnv('JUDGE_CACHE', 'false');
    const req = { systemPrompt: 'Judge', userPrompt: 'input' };
    await callJudge(req);
    await callJudge(req);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('exposes cache stats via getJudgeCache', () => {
    const cache = getJudgeCache();
    expect(cache).toBeDefined();
    const stats = cache.getStats();
    expect(typeof stats.hits).toBe('number');
    expect(typeof stats.misses).toBe('number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/llm-judge-cache.test.ts`
Expected: FAIL — `getJudgeCache` is not exported

- [ ] **Step 3: Modify callJudge to use LlmCache**

In `src/evaluators/llm-judge.ts`, add at the top:

```typescript
import { LlmCache } from '../cache/index.js';
```

Add `cache` field to JudgeRequest:

```typescript
export interface JudgeRequest {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  cache?: boolean; // default true; set false to skip cache
}
```

Create a module-level cache instance and export accessor:

```typescript
const judgeCache = new LlmCache({ ttl: '24h', dir: '.cursor-plugin-evals/judge-cache' });

export function getJudgeCache(): LlmCache {
  return judgeCache;
}
```

At the start of `callJudge`, after resolving `model`, add cache check:

```typescript
  const useCache = request.cache !== false && process.env.JUDGE_CACHE !== 'false';

  if (useCache) {
    const cached = await judgeCache.get(model, request.systemPrompt, request.userPrompt);
    if (cached) {
      return parseJudgeResponse(cached);
    }
  }
```

Before the final `return parseJudgeResponse(content)`, add cache write:

```typescript
  if (useCache) {
    await judgeCache.set(model, request.systemPrompt, request.userPrompt, content).catch(() => {});
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/llm-judge-cache.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run`
Expected: All tests pass

---

### Task 2: Per-Evaluator Judge Model Selection

**Files:**
- Modify: `src/evaluators/llm-judge.ts` (already has model in JudgeRequest)
- Modify: `src/core/types.ts` (add `judgeModel` to EvaluatorContext)
- Create: `src/evaluators/evaluator-models.ts`
- Create: `src/evaluators/evaluator-models.test.ts`

**Context:** Different evaluators need different model capabilities. `keywords` is trivial (cheapest model), `correctness` needs strong reasoning (default model), `security` needs the best. We create a model resolution function that evaluators can use.

- [ ] **Step 1: Write the failing test**

```typescript
// src/evaluators/evaluator-models.test.ts
import { describe, it, expect } from 'vitest';
import { resolveJudgeModel, EVALUATOR_MODEL_TIERS } from './evaluator-models.js';

describe('resolveJudgeModel', () => {
  it('returns explicit model when provided', () => {
    expect(resolveJudgeModel('correctness', 'gpt-4o')).toBe('gpt-4o');
  });

  it('returns cheap model for lightweight evaluators', () => {
    const model = resolveJudgeModel('keywords');
    expect(model).toBe('gpt-5.2-mini');
  });

  it('returns default model for standard evaluators', () => {
    const model = resolveJudgeModel('correctness');
    expect(model).toBeUndefined(); // undefined = use callJudge default
  });

  it('returns undefined for unknown evaluators (uses default)', () => {
    expect(resolveJudgeModel('unknown-eval')).toBeUndefined();
  });
});

describe('EVALUATOR_MODEL_TIERS', () => {
  it('has lightweight tier for cheap evaluators', () => {
    expect(EVALUATOR_MODEL_TIERS.lightweight).toContain('keywords');
    expect(EVALUATOR_MODEL_TIERS.lightweight).toContain('response-quality');
  });

  it('does not include correctness in lightweight', () => {
    expect(EVALUATOR_MODEL_TIERS.lightweight).not.toContain('correctness');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/evaluator-models.test.ts`
Expected: FAIL — cannot resolve `./evaluator-models.js`

- [ ] **Step 3: Implement evaluator-models.ts**

```typescript
// src/evaluators/evaluator-models.ts

/**
 * Evaluator model tiers — which evaluators can use a cheaper model.
 *
 * - lightweight: Simple pattern matching, no complex reasoning needed
 * - standard: Default judge model (undefined = callJudge resolves it)
 * - premium: Not used yet; reserved for evaluators needing the strongest model
 */
export const EVALUATOR_MODEL_TIERS: Record<string, string[]> = {
  lightweight: [
    'keywords',
    'response-quality',
    'content-quality',
    'similarity',
  ],
};

const LIGHTWEIGHT_MODEL = 'gpt-5.2-mini';

/**
 * Resolve which judge model to use for a given evaluator.
 * Returns undefined to use the default judge model.
 */
export function resolveJudgeModel(
  evaluatorName: string,
  explicitModel?: string,
): string | undefined {
  if (explicitModel) return explicitModel;

  if (EVALUATOR_MODEL_TIERS.lightweight.includes(evaluatorName)) {
    return process.env.JUDGE_MODEL_LIGHTWEIGHT ?? LIGHTWEIGHT_MODEL;
  }

  return undefined; // use default
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/evaluator-models.test.ts`
Expected: PASS

---

### Task 3: Judge Call Deduplication

**Files:**
- Create: `src/evaluators/judge-dedup.ts`
- Create: `src/evaluators/judge-dedup.test.ts`

**Context:** When multiple evaluators run on the same test, they often share context (same prompt, same output). If two evaluators produce the same `systemPrompt + userPrompt` hash, we should only call the API once. This is a thin dedup layer that wraps `callJudge`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/evaluators/judge-dedup.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DedupJudge } from './judge-dedup.js';
import type { JudgeResponse } from './llm-judge.js';

describe('DedupJudge', () => {
  it('deduplicates identical requests within a batch', async () => {
    const mockCall = vi.fn<[{ systemPrompt: string; userPrompt: string }], Promise<JudgeResponse>>()
      .mockResolvedValue({ score: 0.9, label: 'CORRECT', explanation: 'good' });

    const dedup = new DedupJudge(mockCall);

    const [r1, r2] = await Promise.all([
      dedup.call({ systemPrompt: 'A', userPrompt: 'B' }),
      dedup.call({ systemPrompt: 'A', userPrompt: 'B' }),
    ]);

    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(r1.score).toBe(0.9);
    expect(r2.score).toBe(0.9);
  });

  it('makes separate calls for different inputs', async () => {
    const mockCall = vi.fn().mockResolvedValue({ score: 0.5, label: 'OK', explanation: 'ok' });

    const dedup = new DedupJudge(mockCall);

    await Promise.all([
      dedup.call({ systemPrompt: 'A', userPrompt: 'B' }),
      dedup.call({ systemPrompt: 'A', userPrompt: 'C' }),
    ]);

    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it('allows new calls after previous batch completes', async () => {
    const mockCall = vi.fn().mockResolvedValue({ score: 0.7, label: 'OK', explanation: 'ok' });

    const dedup = new DedupJudge(mockCall);

    await dedup.call({ systemPrompt: 'A', userPrompt: 'B' });
    await dedup.call({ systemPrompt: 'A', userPrompt: 'B' });

    // These are sequential, not concurrent — so 2 calls (dedup only works within concurrent batch)
    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it('propagates errors to all waiters', async () => {
    const mockCall = vi.fn().mockRejectedValue(new Error('API down'));

    const dedup = new DedupJudge(mockCall);

    const results = await Promise.allSettled([
      dedup.call({ systemPrompt: 'A', userPrompt: 'B' }),
      dedup.call({ systemPrompt: 'A', userPrompt: 'B' }),
    ]);

    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/judge-dedup.test.ts`
Expected: FAIL — cannot resolve `./judge-dedup.js`

- [ ] **Step 3: Implement judge-dedup.ts**

```typescript
// src/evaluators/judge-dedup.ts
import { createHash } from 'crypto';
import type { JudgeRequest, JudgeResponse } from './llm-judge.js';

type JudgeFn = (request: JudgeRequest) => Promise<JudgeResponse>;

/**
 * Deduplicates concurrent judge calls with identical inputs.
 * If two evaluators call with the same systemPrompt + userPrompt + model
 * concurrently, only one API call is made and the result is shared.
 */
export class DedupJudge {
  private readonly inflight = new Map<string, Promise<JudgeResponse>>();
  private readonly judgeFn: JudgeFn;

  constructor(judgeFn: JudgeFn) {
    this.judgeFn = judgeFn;
  }

  private computeKey(request: JudgeRequest): string {
    const hash = createHash('sha256');
    hash.update(request.model ?? '');
    hash.update('\x00');
    hash.update(request.systemPrompt);
    hash.update('\x00');
    hash.update(request.userPrompt);
    return hash.digest('hex');
  }

  async call(request: JudgeRequest): Promise<JudgeResponse> {
    const key = this.computeKey(request);

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const promise = this.judgeFn(request).finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/judge-dedup.test.ts`
Expected: PASS

---

### Task 4: Multi-Judge Panel Tiers

**Files:**
- Modify: `src/evaluators/multi-judge.ts`
- Create: `src/evaluators/multi-judge-tiers.test.ts`

**Context:** The default multi-judge config uses 3 expensive models. We add named presets: `fast` (1 cheap model), `balanced` (2 mid-tier), `thorough` (3 models, current default). Configurable via `multi_judge_tier` in defaults.

- [ ] **Step 1: Write the failing test**

```typescript
// src/evaluators/multi-judge-tiers.test.ts
import { describe, it, expect } from 'vitest';
import { MULTI_JUDGE_TIERS, resolveMultiJudgeConfig, type MultiJudgeTier } from './multi-judge.js';

describe('MULTI_JUDGE_TIERS', () => {
  it('has fast tier with 1 cheap judge', () => {
    expect(MULTI_JUDGE_TIERS.fast.judges).toHaveLength(1);
  });

  it('has balanced tier with 2 judges', () => {
    expect(MULTI_JUDGE_TIERS.balanced.judges).toHaveLength(2);
  });

  it('has thorough tier with 3 judges', () => {
    expect(MULTI_JUDGE_TIERS.thorough.judges).toHaveLength(3);
  });
});

describe('resolveMultiJudgeConfig', () => {
  it('returns fast config for fast tier', () => {
    const config = resolveMultiJudgeConfig('fast');
    expect(config.judges).toHaveLength(1);
  });

  it('returns balanced config for balanced tier', () => {
    const config = resolveMultiJudgeConfig('balanced');
    expect(config.judges).toHaveLength(2);
  });

  it('returns default (thorough) for undefined', () => {
    const config = resolveMultiJudgeConfig();
    expect(config.judges).toHaveLength(3);
  });

  it('returns default for unknown tier', () => {
    const config = resolveMultiJudgeConfig('unknown' as MultiJudgeTier);
    expect(config.judges).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/multi-judge-tiers.test.ts`
Expected: FAIL — `MULTI_JUDGE_TIERS` is not exported

- [ ] **Step 3: Add tiers to multi-judge.ts**

Append to `src/evaluators/multi-judge.ts`:

```typescript
export type MultiJudgeTier = 'fast' | 'balanced' | 'thorough';

export const MULTI_JUDGE_TIERS: Record<MultiJudgeTier, MultiJudgeConfig> = {
  fast: {
    judges: [{ model: 'gpt-5.2-mini', weight: 1.0 }],
    aggregation: 'weighted_average',
    blind: true,
    supremeCourtEnabled: false,
  },
  balanced: {
    judges: [
      { model: 'gpt-5.2', weight: 1.0 },
      { model: 'gemini-2.5-flash', weight: 1.0 },
    ],
    aggregation: 'weighted_average',
    blind: true,
    supremeCourtEnabled: false,
  },
  thorough: DEFAULT_MULTI_JUDGE_CONFIG,
};

export function resolveMultiJudgeConfig(tier?: MultiJudgeTier | string): MultiJudgeConfig {
  if (!tier) return DEFAULT_MULTI_JUDGE_CONFIG;
  return MULTI_JUDGE_TIERS[tier as MultiJudgeTier] ?? DEFAULT_MULTI_JUDGE_CONFIG;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/multi-judge-tiers.test.ts`
Expected: PASS

---

### Task 5: Cost Estimation (--estimate-cost)

**Files:**
- Create: `src/cost-advisor/estimator.ts`
- Create: `src/cost-advisor/estimator.test.ts`
- Modify: `src/cli/main.ts` (add `--estimate-cost` flag)

**Context:** Count tests x LLM evaluators x model pricing to predict cost without running. Uses the pricing catalog and evaluator model tiers.

- [ ] **Step 1: Write the failing test**

```typescript
// src/cost-advisor/estimator.test.ts
import { describe, it, expect } from 'vitest';
import { estimateRunCost, type CostEstimate } from './estimator.js';
import type { EvalConfig } from '../core/types.js';

describe('estimateRunCost', () => {
  it('estimates cost for LLM evaluators', () => {
    const config: Partial<EvalConfig> = {
      defaults: { judgeModel: 'gpt-5.2' },
      suites: [
        {
          name: 'test-suite',
          layer: 'llm',
          tests: [
            { name: 't1', prompt: 'test', expected: {}, evaluators: ['correctness', 'keywords'] },
            { name: 't2', prompt: 'test', expected: {}, evaluators: ['correctness'] },
          ] as any,
        } as any,
      ],
    };

    const estimate = estimateRunCost(config as EvalConfig);
    expect(estimate.totalEstimatedUsd).toBeGreaterThan(0);
    expect(estimate.breakdown).toHaveLength(2); // 2 tests
    expect(estimate.judgeCallCount).toBe(3); // 2 correctness + 1 keywords
  });

  it('returns zero for non-LLM evaluators', () => {
    const config: Partial<EvalConfig> = {
      suites: [
        {
          name: 'static-suite',
          layer: 'static',
          tests: [{ name: 't1', check: 'manifest' }] as any,
        } as any,
      ],
    };

    const estimate = estimateRunCost(config as EvalConfig);
    expect(estimate.totalEstimatedUsd).toBe(0);
    expect(estimate.judgeCallCount).toBe(0);
  });

  it('multiplies by repetitions', () => {
    const config: Partial<EvalConfig> = {
      defaults: { repetitions: 5, judgeModel: 'gpt-5.2' },
      suites: [
        {
          name: 'suite',
          layer: 'llm',
          tests: [
            { name: 't1', prompt: 'test', expected: {}, evaluators: ['correctness'] },
          ] as any,
        } as any,
      ],
    };

    const estimate = estimateRunCost(config as EvalConfig);
    expect(estimate.judgeCallCount).toBe(5); // 1 test x 1 evaluator x 5 repetitions
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/cost-advisor/estimator.test.ts`
Expected: FAIL — cannot resolve `./estimator.js`

- [ ] **Step 3: Implement estimator.ts**

```typescript
// src/cost-advisor/estimator.ts
import { getPricingCatalog } from '../pricing/index.js';
import { resolveJudgeModel } from '../evaluators/evaluator-models.js';
import type { EvalConfig } from '../core/types.js';

const LLM_EVALUATORS = new Set([
  'correctness', 'groundedness', 'g-eval', 'similarity',
  'context-faithfulness', 'conversation-coherence', 'criteria',
  'plan-quality', 'task-completion', 'security', 'resistance',
  'keywords', 'response-quality', 'content-quality',
]);

// Rough estimate: ~500 input tokens + ~200 output tokens per judge call
const AVG_INPUT_TOKENS = 500;
const AVG_OUTPUT_TOKENS = 200;

export interface CostBreakdown {
  test: string;
  evaluators: string[];
  judgeCalls: number;
  estimatedUsd: number;
}

export interface CostEstimate {
  totalEstimatedUsd: number;
  judgeCallCount: number;
  breakdown: CostBreakdown[];
  modelBreakdown: Record<string, { calls: number; estimatedUsd: number }>;
}

export function estimateRunCost(config: EvalConfig): CostEstimate {
  const catalog = getPricingCatalog();
  const defaultModel = config.defaults?.judgeModel ?? 'gpt-5.2';
  const repetitions = config.defaults?.repetitions ?? 1;

  const breakdown: CostBreakdown[] = [];
  const modelCounts = new Map<string, number>();
  let totalCalls = 0;
  let totalCost = 0;

  for (const suite of config.suites ?? []) {
    if (suite.layer === 'static' || suite.layer === 'unit') continue;

    for (const test of suite.tests ?? []) {
      const llmTest = test as { evaluators?: string[]; name: string };
      const evaluators = (llmTest.evaluators ?? []).filter((e) => LLM_EVALUATORS.has(e));
      if (evaluators.length === 0) continue;

      const calls = evaluators.length * repetitions;
      let testCost = 0;

      for (const evalName of evaluators) {
        const model = resolveJudgeModel(evalName) ?? defaultModel;
        const pricing = findPricing(catalog, model);
        if (pricing) {
          const callCost =
            (AVG_INPUT_TOKENS / 1_000_000) * pricing.input +
            (AVG_OUTPUT_TOKENS / 1_000_000) * pricing.output;
          testCost += callCost * repetitions;
        }
        modelCounts.set(model, (modelCounts.get(model) ?? 0) + repetitions);
      }

      totalCalls += calls;
      totalCost += testCost;
      breakdown.push({ test: llmTest.name, evaluators, judgeCalls: calls, estimatedUsd: testCost });
    }
  }

  const modelBreakdown: Record<string, { calls: number; estimatedUsd: number }> = {};
  for (const [model, calls] of modelCounts) {
    const pricing = findPricing(catalog, model);
    const cost = pricing
      ? calls * ((AVG_INPUT_TOKENS / 1_000_000) * pricing.input + (AVG_OUTPUT_TOKENS / 1_000_000) * pricing.output)
      : 0;
    modelBreakdown[model] = { calls, estimatedUsd: cost };
  }

  return { totalEstimatedUsd: totalCost, judgeCallCount: totalCalls, breakdown, modelBreakdown };
}

function findPricing(
  catalog: Record<string, { input: number; output: number; cached?: number }>,
  model: string,
): { input: number; output: number } | null {
  if (catalog[model]) return catalog[model];
  const lower = model.toLowerCase();
  for (const [key, pricing] of Object.entries(catalog)) {
    if (lower.includes(key.toLowerCase())) return pricing;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/cost-advisor/estimator.test.ts`
Expected: PASS

- [ ] **Step 5: Add --estimate-cost to CLI**

In `src/cli/main.ts`, find the `run` command options. Add after the last option before `.action(`:

```typescript
  .option('--estimate-cost', 'estimate LLM costs without running')
```

In the run command action, at the very start (after config load, before execution), add:

```typescript
      if (opts.estimateCost) {
        const { estimateRunCost } = await import('../cost-advisor/estimator.js');
        const estimate = estimateRunCost(config);
        log.header('Cost Estimate');
        log.info(`  Judge calls: ${estimate.judgeCallCount}`);
        log.info(`  Estimated cost: $${estimate.totalEstimatedUsd.toFixed(4)}`);
        log.info('');
        for (const [model, data] of Object.entries(estimate.modelBreakdown)) {
          log.info(`  ${model}: ${data.calls} calls (~$${data.estimatedUsd.toFixed(4)})`);
        }
        return;
      }
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx tsc --noEmit`
Expected: 0 errors (ignoring pre-existing esql-execution.ts issues)

---

### Task 6: Judge Fixture Recording and Replay

**Files:**
- Create: `src/evaluators/judge-fixtures.ts`
- Create: `src/evaluators/judge-fixtures.test.ts`

**Context:** Like MCP fixtures, we record judge call inputs/outputs to a JSONL file. In replay mode, judge calls return recorded responses instead of calling the API. Controlled via `--record-judges` and `--replay-judges` CLI flags.

- [ ] **Step 1: Write the failing test**

```typescript
// src/evaluators/judge-fixtures.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JudgeFixtureStore } from './judge-fixtures.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('JudgeFixtureStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'judge-fixtures-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('records and replays a judge call', async () => {
    const store = new JudgeFixtureStore(tempDir);

    await store.record(
      { systemPrompt: 'Judge this', userPrompt: 'test input', model: 'gpt-5.2' },
      { score: 0.9, label: 'CORRECT', explanation: 'good' },
    );

    const replayed = await store.replay({ systemPrompt: 'Judge this', userPrompt: 'test input', model: 'gpt-5.2' });
    expect(replayed).not.toBeNull();
    expect(replayed!.score).toBe(0.9);
  });

  it('returns null for unrecorded requests', async () => {
    const store = new JudgeFixtureStore(tempDir);
    const result = await store.replay({ systemPrompt: 'A', userPrompt: 'B' });
    expect(result).toBeNull();
  });

  it('records multiple entries', async () => {
    const store = new JudgeFixtureStore(tempDir);

    await store.record(
      { systemPrompt: 'A', userPrompt: '1' },
      { score: 0.5, label: 'OK', explanation: 'a' },
    );
    await store.record(
      { systemPrompt: 'A', userPrompt: '2' },
      { score: 0.8, label: 'GOOD', explanation: 'b' },
    );

    const r1 = await store.replay({ systemPrompt: 'A', userPrompt: '1' });
    const r2 = await store.replay({ systemPrompt: 'A', userPrompt: '2' });
    expect(r1!.score).toBe(0.5);
    expect(r2!.score).toBe(0.8);
  });

  it('persists to disk and loads from a new instance', async () => {
    const store1 = new JudgeFixtureStore(tempDir);
    await store1.record(
      { systemPrompt: 'X', userPrompt: 'Y' },
      { score: 0.7, label: 'OK', explanation: 'persisted' },
    );
    await store1.flush();

    const store2 = new JudgeFixtureStore(tempDir);
    await store2.load();
    const result = await store2.replay({ systemPrompt: 'X', userPrompt: 'Y' });
    expect(result!.explanation).toBe('persisted');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/judge-fixtures.test.ts`
Expected: FAIL — cannot resolve `./judge-fixtures.js`

- [ ] **Step 3: Implement judge-fixtures.ts**

```typescript
// src/evaluators/judge-fixtures.ts
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { JudgeRequest, JudgeResponse } from './llm-judge.js';

interface FixtureEntry {
  key: string;
  request: { systemPrompt: string; userPrompt: string; model?: string };
  response: JudgeResponse;
}

const FIXTURE_FILE = 'judge-fixtures.jsonl';

export class JudgeFixtureStore {
  private readonly dir: string;
  private readonly entries = new Map<string, JudgeResponse>();
  private pending: FixtureEntry[] = [];

  constructor(dir: string) {
    this.dir = dir;
  }

  private computeKey(request: Partial<JudgeRequest>): string {
    const hash = createHash('sha256');
    hash.update(request.model ?? '');
    hash.update('\x00');
    hash.update(request.systemPrompt ?? '');
    hash.update('\x00');
    hash.update(request.userPrompt ?? '');
    return hash.digest('hex');
  }

  async load(): Promise<void> {
    try {
      const content = await readFile(join(this.dir, FIXTURE_FILE), 'utf-8');
      for (const line of content.split('\n').filter(Boolean)) {
        const entry = JSON.parse(line) as FixtureEntry;
        this.entries.set(entry.key, entry.response);
      }
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
      if (!isNotFound) throw err;
    }
  }

  async record(request: Partial<JudgeRequest>, response: JudgeResponse): Promise<void> {
    const key = this.computeKey(request);
    this.entries.set(key, response);
    this.pending.push({
      key,
      request: {
        systemPrompt: request.systemPrompt ?? '',
        userPrompt: request.userPrompt ?? '',
        model: request.model,
      },
      response,
    });
  }

  async replay(request: Partial<JudgeRequest>): Promise<JudgeResponse | null> {
    const key = this.computeKey(request);
    return this.entries.get(key) ?? null;
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    await mkdir(this.dir, { recursive: true });
    const lines = this.pending.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(join(this.dir, FIXTURE_FILE), lines, 'utf-8');
    this.pending = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/judge-fixtures.test.ts`
Expected: PASS

---

### Task 7: Full Validation and Commit

**Files:** None (validation only)

- [ ] **Step 1: Run all new tests**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run src/evaluators/llm-judge-cache.test.ts src/evaluators/evaluator-models.test.ts src/evaluators/judge-dedup.test.ts src/evaluators/multi-judge-tiers.test.ts src/cost-advisor/estimator.test.ts src/evaluators/judge-fixtures.test.ts`
Expected: All pass

- [ ] **Step 2: Run full test suite**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/patrykkopycinski/Projects/cursor-plugin-evals && npx tsc --noEmit`
Expected: 0 errors (ignoring pre-existing esql-execution.ts)

- [ ] **Step 4: Commit**

```bash
git add src/evaluators/llm-judge.ts src/evaluators/llm-judge-cache.test.ts \
  src/evaluators/evaluator-models.ts src/evaluators/evaluator-models.test.ts \
  src/evaluators/judge-dedup.ts src/evaluators/judge-dedup.test.ts \
  src/evaluators/multi-judge.ts src/evaluators/multi-judge-tiers.test.ts \
  src/cost-advisor/estimator.ts src/cost-advisor/estimator.test.ts \
  src/evaluators/judge-fixtures.ts src/evaluators/judge-fixtures.test.ts \
  src/cli/main.ts
git commit -m "feat: LLM cost optimization — caching, dedup, model tiers, estimation, fixtures

- Wire LlmCache into callJudge() for automatic response caching (24h TTL)
- Add per-evaluator judge model selection (lightweight evaluators use gpt-5.2-mini)
- Add DedupJudge for concurrent call deduplication within a test
- Add multi-judge panel tiers: fast (1 model), balanced (2), thorough (3)
- Add --estimate-cost CLI flag for pre-run cost prediction
- Add JudgeFixtureStore for recording/replaying judge responses"
```

---

### Task 8: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/_sidebar.md`
- Modify: `docs/evaluators.md`
- Create: `docs/cost-optimization.md`

- [ ] **Step 1: Create docs/cost-optimization.md**

Create with content covering: judge caching (JUDGE_CACHE env), per-evaluator models (JUDGE_MODEL_LIGHTWEIGHT env), multi-judge tiers (fast/balanced/thorough), cost estimation (--estimate-cost), judge fixtures (--record-judges/--replay-judges), deduplication (automatic).

- [ ] **Step 2: Add sidebar entry**

In `docs/_sidebar.md`, after `[Cost Optimization](cost-advisor.md)`, add:
```
  - [LLM Cost Optimization](cost-optimization.md)
```

- [ ] **Step 3: Update README highlights**

Add to the Evaluation bullet list:
```
- LLM cost optimization: judge caching, per-evaluator model tiers, call deduplication
- Pre-run cost estimation with `--estimate-cost`
```

- [ ] **Step 4: Commit docs**

```bash
git add docs/ README.md
git commit -m "docs: add LLM cost optimization guide"
```
