# ES|QL Execution-Based Evaluators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three deterministic evaluators for ES|QL queries that score by executing against a live Elasticsearch cluster, matching structural patterns, and comparing result sets — replacing LLM-as-judge for ES|QL correctness.

**Architecture:** Three new evaluators (`esql-execution`, `esql-pattern`, `esql-result`) that follow existing `Evaluator` interface conventions. All use `EvaluatorKind = 'CODE'` (no LLM calls). They reuse the ES connection logic from `cluster-state.ts`. A shared `esql-utils.ts` handles query extraction and ES `_query` API calls.

**Tech Stack:** TypeScript, Elasticsearch `_query` API, existing `Evaluator` interface, Vitest for tests.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/evaluators/esql-utils.ts` | Shared: extract ES|QL from output, execute via `_query` API, build ES headers |
| Create | `src/evaluators/esql-utils.test.ts` | Tests for shared utilities |
| Create | `src/evaluators/esql-execution.ts` | Evaluator: does the generated query execute? |
| Create | `src/evaluators/esql-execution.test.ts` | Tests for execution evaluator |
| Create | `src/evaluators/esql-pattern.ts` | Evaluator: regex pattern matching with equivalence classes |
| Create | `src/evaluators/esql-pattern.test.ts` | Tests for pattern evaluator |
| Create | `src/evaluators/esql-result.ts` | Evaluator: column overlap + row count similarity |
| Create | `src/evaluators/esql-result.test.ts` | Tests for result evaluator |
| Modify | `src/evaluators/index.ts` | Register all three new evaluators |
| Modify | `src/core/types.ts` | Add `esqlGolden` field to `ExpectedOutput` |
| Modify | `src/core/config.ts` | Add `esql_golden` to `ExpectedOutputSchema` |

---

### Task 1: Add `esqlGolden` to `ExpectedOutput` type and config schema

**Files:**
- Modify: `src/core/types.ts:195-203`
- Modify: `src/core/config.ts:52-60`

The YAML config needs a new `esql_golden` field under `expected:` to hold the reference ES|QL query. This is separate from `response_contains` because we need the raw query string for execution, not just keyword matching.

- [ ] **Step 1: Add `esqlGolden` to `ExpectedOutput` interface**

In `src/core/types.ts`, add the field to `ExpectedOutput`:

```typescript
export interface ExpectedOutput {
  tools?: string[];
  toolArgs?: Record<string, Record<string, unknown>>;
  toolSequence?: string[];
  goldenPath?: string[];
  responseContains?: string[];
  responseNotContains?: string[];
  clusterState?: ClusterStateAssertion[];
  esqlGolden?: string;
}
```

- [ ] **Step 2: Add `esql_golden` to config schema**

In `src/core/config.ts`, add to `ExpectedOutputSchema`:

```typescript
const ExpectedOutputSchema = z.object({
  tools: z.array(z.string()).optional(),
  tool_args: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  tool_sequence: z.array(z.string()).optional(),
  golden_path: z.array(z.string()).optional(),
  response_contains: z.array(z.string()).optional(),
  response_not_contains: z.array(z.string()).optional(),
  cluster_state: z.array(ClusterStateAssertionSchema).optional(),
  esql_golden: z.string().optional(),
});
```

Note: Also verify that the snake_case → camelCase transform in config.ts handles `esql_golden` → `esqlGolden`. Search for `transformKeys` or the snake→camel conversion logic and confirm `esql_golden` will be transformed correctly.

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No errors related to `esqlGolden`.

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts src/core/config.ts
git commit -m "feat(esql): add esqlGolden field to ExpectedOutput type and config schema"
```

---

### Task 2: Create shared ES|QL utilities

**Files:**
- Create: `src/evaluators/esql-utils.ts`
- Create: `src/evaluators/esql-utils.test.ts`

Two pure functions: `extractEsql` (pull ES|QL from LLM output) and `executeEsql` (run against ES). Plus header-building reused from `cluster-state.ts`.

- [ ] **Step 1: Write tests for `extractEsql`**

Create `src/evaluators/esql-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractEsql } from './esql-utils.js';

describe('extractEsql', () => {
  it('extracts from ```esql fenced block', () => {
    const input = 'Here is the query:\n```esql\nFROM logs | LIMIT 10\n```\nDone.';
    expect(extractEsql(input)).toBe('FROM logs | LIMIT 10');
  });

  it('extracts from generic fenced block with FROM keyword', () => {
    const input = '```\nFROM logs | KEEP @timestamp\n```';
    expect(extractEsql(input)).toBe('FROM logs | KEEP @timestamp');
  });

  it('prefers ```esql block over generic block', () => {
    const input = '```\nSELECT 1\n```\n```esql\nFROM logs\n```';
    expect(extractEsql(input)).toBe('FROM logs');
  });

  it('extracts bare pipe-syntax lines as fallback', () => {
    const input = 'The query is:\nFROM logs\n| KEEP message\n| LIMIT 5';
    expect(extractEsql(input)).toBe('FROM logs\n| KEEP message\n| LIMIT 5');
  });

  it('returns null when no ES|QL found', () => {
    expect(extractEsql('No query here, just text.')).toBeNull();
  });

  it('trims whitespace from extracted query', () => {
    const input = '```esql\n  FROM logs | LIMIT 10  \n```';
    expect(extractEsql(input)).toBe('FROM logs | LIMIT 10');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/evaluators/esql-utils.test.ts 2>&1 | tail -10`
Expected: FAIL — module `./esql-utils.js` not found.

- [ ] **Step 3: Implement `extractEsql` and `executeEsql`**

Create `src/evaluators/esql-utils.ts`:

```typescript
export interface EsqlResult {
  columns: Array<{ name: string; type: string }>;
  values: unknown[][];
  error?: undefined;
}

export interface EsqlError {
  columns?: undefined;
  values?: undefined;
  error: string;
  isIndexNotFound?: boolean;
}

export type EsqlOutcome = EsqlResult | EsqlError;

/**
 * Extract an ES|QL query from LLM output text.
 * Priority: ```esql blocks > generic fenced blocks with FROM > bare pipe-syntax lines.
 */
export function extractEsql(text: string): string | null {
  // 1. ```esql fenced block
  const esqlFenced = text.match(/```esql\s*\n([\s\S]*?)```/i);
  if (esqlFenced) return esqlFenced[1].trim();

  // 2. Generic fenced block containing FROM keyword
  const genericFenced = text.match(/```\s*\n([\s\S]*?)```/);
  if (genericFenced && /\bFROM\b/i.test(genericFenced[1])) {
    return genericFenced[1].trim();
  }

  // 3. Bare pipe-syntax: lines starting with FROM followed by | lines
  const lines = text.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*FROM\b/i.test(lines[i])) {
      start = i;
      break;
    }
  }

  if (start >= 0) {
    const queryLines = [lines[start]];
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\s*\|/.test(lines[i])) {
        queryLines.push(lines[i]);
      } else {
        break;
      }
    }
    if (queryLines.length > 0) return queryLines.join('\n').trim();
  }

  return null;
}

/**
 * Build Authorization headers for Elasticsearch.
 * Reuses the same env vars as cluster-state evaluator.
 */
export function buildEsHeaders(config?: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const apiKey = (config?.['esApiKey'] as string | undefined) ?? process.env.ES_API_KEY;
  const username = (config?.['esUsername'] as string | undefined) ?? process.env.TEST_ES_USERNAME;
  const password = (config?.['esPassword'] as string | undefined) ?? process.env.TEST_ES_PASSWORD;

  if (apiKey) {
    headers['Authorization'] = `ApiKey ${apiKey}`;
  } else if (username && password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  return headers;
}

/**
 * Resolve the Elasticsearch URL from config or environment.
 */
export function resolveEsUrl(config?: Record<string, unknown>): string | undefined {
  return (
    (config?.['esUrl'] as string | undefined) ??
    process.env.ELASTICSEARCH_URL ??
    process.env.ES_URL
  );
}

/**
 * Execute an ES|QL query against a live Elasticsearch cluster.
 * Returns structured result or error.
 */
export async function executeEsql(
  query: string,
  esUrl: string,
  headers: Record<string, string>,
): Promise<EsqlOutcome> {
  const url = `${esUrl.replace(/\/$/, '')}/_query`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const isIndexNotFound =
        res.status === 400 && (text.includes('index_not_found') || text.includes('Unknown index'));
      return { error: `HTTP ${res.status}: ${text.slice(0, 300)}`, isIndexNotFound };
    }

    const body = (await res.json()) as { columns: Array<{ name: string; type: string }>; values: unknown[][] };
    return { columns: body.columns ?? [], values: body.values ?? [] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/evaluators/esql-utils.test.ts 2>&1 | tail -10`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/evaluators/esql-utils.ts src/evaluators/esql-utils.test.ts
git commit -m "feat(esql): add shared utilities for ES|QL extraction and execution"
```

---

### Task 3: Create `esql-execution` evaluator

**Files:**
- Create: `src/evaluators/esql-execution.ts`
- Create: `src/evaluators/esql-execution.test.ts`

Scores whether the generated query executes against the cluster. Full credit (1.0) if it runs, partial credit (0.4) for `index_not_found` (valid syntax, wrong index), zero for other errors.

- [ ] **Step 1: Write tests**

Create `src/evaluators/esql-execution.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EsqlExecutionEvaluator } from './esql-execution.js';
import type { EvaluatorContext } from '../core/types.js';

// Mock the esql-utils module
vi.mock('./esql-utils.js', async () => {
  const actual = await vi.importActual<typeof import('./esql-utils.js')>('./esql-utils.js');
  return {
    ...actual,
    executeEsql: vi.fn(),
  };
});

import { executeEsql } from './esql-utils.js';
const mockExecuteEsql = vi.mocked(executeEsql);

function makeContext(output: string, config?: Record<string, unknown>): EvaluatorContext {
  return {
    testName: 'test',
    prompt: 'test prompt',
    toolCalls: [],
    finalOutput: output,
    config: { esUrl: 'http://localhost:9200', ...config },
  };
}

describe('EsqlExecutionEvaluator', () => {
  const evaluator = new EsqlExecutionEvaluator();

  it('scores 1.0 when query executes successfully', async () => {
    mockExecuteEsql.mockResolvedValue({
      columns: [{ name: 'message', type: 'keyword' }],
      values: [['hello']],
    });
    const result = await evaluator.evaluate(makeContext('```esql\nFROM logs | LIMIT 1\n```'));
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('scores 0.4 for index_not_found (valid syntax)', async () => {
    mockExecuteEsql.mockResolvedValue({
      error: 'HTTP 400: index_not_found',
      isIndexNotFound: true,
    });
    const result = await evaluator.evaluate(makeContext('```esql\nFROM nonexistent | LIMIT 1\n```'));
    expect(result.score).toBe(0.4);
    expect(result.pass).toBe(false);
  });

  it('scores 0 for execution errors', async () => {
    mockExecuteEsql.mockResolvedValue({
      error: 'HTTP 400: parsing_exception',
    });
    const result = await evaluator.evaluate(makeContext('```esql\nSELECT * FROM logs\n```'));
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
  });

  it('scores 0 when no ES|QL can be extracted', async () => {
    const result = await evaluator.evaluate(makeContext('No query here'));
    expect(result.score).toBe(0);
    expect(result.label).toBe('no_query');
  });

  it('skips when esUrl is not configured', async () => {
    const result = await evaluator.evaluate(makeContext('```esql\nFROM logs\n```', { esUrl: undefined }));
    expect(result.pass).toBe(false);
    expect(result.label).toBe('no_es_url');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/evaluators/esql-execution.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the evaluator**

Create `src/evaluators/esql-execution.ts`:

```typescript
import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { extractEsql, executeEsql, buildEsHeaders, resolveEsUrl } from './esql-utils.js';

export class EsqlExecutionEvaluator implements Evaluator {
  name = 'esql-execution';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const esUrl = resolveEsUrl(context.config);
    if (!esUrl) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'no_es_url',
        explanation: 'No Elasticsearch URL configured (esUrl, ELASTICSEARCH_URL, or ES_URL required)',
      };
    }

    const query = extractEsql(context.finalOutput ?? '');
    if (!query) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'no_query',
        explanation: 'Could not extract ES|QL query from output',
      };
    }

    const headers = buildEsHeaders(context.config);
    const outcome = await executeEsql(query, esUrl, headers);

    if ('error' in outcome && outcome.error) {
      const score = outcome.isIndexNotFound ? 0.4 : 0;
      const label = outcome.isIndexNotFound ? 'index_not_found' : 'error';
      return {
        evaluator: this.name,
        score,
        pass: false,
        label,
        explanation: outcome.isIndexNotFound
          ? `Valid syntax but wrong index: ${outcome.error}`
          : `Query failed: ${outcome.error}`,
        metadata: { query, error: outcome.error },
      };
    }

    return {
      evaluator: this.name,
      score: 1.0,
      pass: true,
      label: 'executed',
      explanation: `Query executed successfully (${outcome.columns.length} columns, ${outcome.values.length} rows)`,
      metadata: {
        query,
        columnCount: outcome.columns.length,
        rowCount: outcome.values.length,
      },
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/evaluators/esql-execution.test.ts 2>&1 | tail -10`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/evaluators/esql-execution.ts src/evaluators/esql-execution.test.ts
git commit -m "feat(esql): add esql-execution evaluator with partial credit for index_not_found"
```

---

### Task 4: Create `esql-pattern` evaluator

**Files:**
- Create: `src/evaluators/esql-pattern.ts`
- Create: `src/evaluators/esql-pattern.test.ts`

Regex-based pattern matching against the generated query with equivalence classes. The evaluator checks `responseContains` entries as pattern criteria and supports equivalence (e.g. `LOOKUP JOIN` ≈ `ENRICH`, `DISSECT` ≈ `GROK`).

- [ ] **Step 1: Write tests**

Create `src/evaluators/esql-pattern.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EsqlPatternEvaluator, ESQL_EQUIVALENCES } from './esql-pattern.js';
import type { EvaluatorContext } from '../core/types.js';

function makeContext(
  output: string,
  patterns: string[],
  config?: Record<string, unknown>,
): EvaluatorContext {
  return {
    testName: 'test',
    prompt: 'test prompt',
    toolCalls: [],
    finalOutput: output,
    expected: { responseContains: patterns },
    config,
  };
}

describe('EsqlPatternEvaluator', () => {
  const evaluator = new EsqlPatternEvaluator();

  it('scores 1.0 when all patterns match', async () => {
    const result = await evaluator.evaluate(
      makeContext('```esql\nFROM logs | STATS COUNT(*) BY level | SORT level DESC\n```', [
        'STATS',
        'SORT.*DESC',
      ]),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('scores proportionally for partial matches', async () => {
    const result = await evaluator.evaluate(
      makeContext('```esql\nFROM logs | STATS COUNT(*) BY level\n```', [
        'STATS',
        'SORT.*DESC',
        'LIMIT',
      ]),
    );
    // 1 of 3 patterns match
    expect(result.score).toBeCloseTo(1 / 3, 2);
  });

  it('accepts ENRICH as equivalent to LOOKUP JOIN', async () => {
    const result = await evaluator.evaluate(
      makeContext('```esql\nFROM logs | ENRICH policy\n```', ['LOOKUP JOIN']),
    );
    expect(result.score).toBe(1.0);
  });

  it('accepts GROK as equivalent to DISSECT', async () => {
    const result = await evaluator.evaluate(
      makeContext('```esql\nFROM logs | GROK message "%{IP:ip}"\n```', ['DISSECT']),
    );
    expect(result.score).toBe(1.0);
  });

  it('returns skip when no patterns specified', async () => {
    const result = await evaluator.evaluate(makeContext('FROM logs', []));
    expect(result.pass).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('scores 0 when no ES|QL found in output', async () => {
    const result = await evaluator.evaluate(makeContext('No query here', ['STATS']));
    expect(result.score).toBe(0);
    expect(result.label).toBe('no_query');
  });
});

describe('ESQL_EQUIVALENCES', () => {
  it('contains bidirectional equivalence pairs', () => {
    expect(ESQL_EQUIVALENCES).toContainEqual(['LOOKUP JOIN', 'ENRICH']);
    expect(ESQL_EQUIVALENCES).toContainEqual(['DISSECT', 'GROK']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/evaluators/esql-pattern.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the evaluator**

Create `src/evaluators/esql-pattern.ts`:

```typescript
import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { extractEsql } from './esql-utils.js';

/**
 * ES|QL command equivalence classes.
 * If a pattern mentions one command, its equivalent is also accepted.
 */
export const ESQL_EQUIVALENCES: [string, string][] = [
  ['LOOKUP JOIN', 'ENRICH'],
  ['DISSECT', 'GROK'],
  ['MATCH', 'QSTR'],
  ['MV_EXPAND', 'MV_SORT'],
];

function matchesWithEquivalence(query: string, pattern: string): boolean {
  try {
    if (new RegExp(pattern, 'i').test(query)) return true;
  } catch {
    if (query.toLowerCase().includes(pattern.toLowerCase())) return true;
  }

  for (const [a, b] of ESQL_EQUIVALENCES) {
    if (pattern.toUpperCase().includes(a)) {
      const altPattern = pattern.replace(new RegExp(a.replace(/\s+/g, '\\s+'), 'gi'), b);
      try {
        if (new RegExp(altPattern, 'i').test(query)) return true;
      } catch {
        if (query.toLowerCase().includes(altPattern.toLowerCase())) return true;
      }
    }
    if (pattern.toUpperCase().includes(b)) {
      const altPattern = pattern.replace(new RegExp(b.replace(/\s+/g, '\\s+'), 'gi'), a);
      try {
        if (new RegExp(altPattern, 'i').test(query)) return true;
      } catch {
        if (query.toLowerCase().includes(altPattern.toLowerCase())) return true;
      }
    }
  }

  return false;
}

export class EsqlPatternEvaluator implements Evaluator {
  name = 'esql-pattern';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const patterns = context.expected?.responseContains ?? [];

    if (patterns.length === 0) {
      return {
        evaluator: this.name,
        score: 1,
        pass: true,
        skipped: true,
        label: 'no_patterns',
        explanation: 'No patterns specified; skipping.',
      };
    }

    const query = extractEsql(context.finalOutput ?? '');
    if (!query) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'no_query',
        explanation: 'Could not extract ES|QL query from output',
      };
    }

    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const pattern of patterns) {
      if (matchesWithEquivalence(query, pattern)) {
        matched.push(pattern);
      } else {
        unmatched.push(pattern);
      }
    }

    const score = Math.round((matched.length / patterns.length) * 1000) / 1000;
    const threshold = (context.config?.['esql-pattern'] as number | undefined) ?? 0.7;

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= 1 ? 'all_matched' : score > 0 ? 'partial' : 'none_matched',
      explanation:
        unmatched.length > 0
          ? `${matched.length}/${patterns.length} patterns matched. Missing: ${unmatched.join(', ')}`
          : `All ${patterns.length} patterns matched`,
      metadata: { matched, unmatched, query },
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/evaluators/esql-pattern.test.ts 2>&1 | tail -10`
Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/evaluators/esql-pattern.ts src/evaluators/esql-pattern.test.ts
git commit -m "feat(esql): add esql-pattern evaluator with equivalence class support"
```

---

### Task 5: Create `esql-result` evaluator

**Files:**
- Create: `src/evaluators/esql-result.ts`
- Create: `src/evaluators/esql-result.test.ts`

Compares the result sets of the generated query and the golden query, both executed on the live cluster. Two sub-metrics (equal weight): column overlap and row count similarity.

- [ ] **Step 1: Write tests**

Create `src/evaluators/esql-result.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EsqlResultEvaluator, columnOverlap, rowCountSimilarity } from './esql-result.js';
import type { EvaluatorContext } from '../core/types.js';

vi.mock('./esql-utils.js', async () => {
  const actual = await vi.importActual<typeof import('./esql-utils.js')>('./esql-utils.js');
  return {
    ...actual,
    executeEsql: vi.fn(),
  };
});

import { executeEsql } from './esql-utils.js';
const mockExecuteEsql = vi.mocked(executeEsql);

function makeContext(
  output: string,
  esqlGolden?: string,
  config?: Record<string, unknown>,
): EvaluatorContext {
  return {
    testName: 'test',
    prompt: 'test prompt',
    toolCalls: [],
    finalOutput: output,
    expected: esqlGolden ? { esqlGolden } : undefined,
    config: { esUrl: 'http://localhost:9200', ...config },
  };
}

describe('columnOverlap', () => {
  it('returns 1.0 for identical columns', () => {
    const ref = [{ name: 'a', type: 'keyword' }, { name: 'b', type: 'long' }];
    const gen = [{ name: 'a', type: 'keyword' }, { name: 'b', type: 'long' }];
    expect(columnOverlap(ref, gen)).toBe(1.0);
  });

  it('returns 1.0 when generated has extra columns', () => {
    const ref = [{ name: 'a', type: 'keyword' }];
    const gen = [{ name: 'a', type: 'keyword' }, { name: 'b', type: 'long' }];
    expect(columnOverlap(ref, gen)).toBe(1.0);
  });

  it('returns 0.5 when half the reference columns are present', () => {
    const ref = [{ name: 'a', type: 'keyword' }, { name: 'b', type: 'long' }];
    const gen = [{ name: 'a', type: 'keyword' }, { name: 'c', type: 'text' }];
    expect(columnOverlap(ref, gen)).toBe(0.5);
  });

  it('is case-insensitive', () => {
    const ref = [{ name: 'Message', type: 'keyword' }];
    const gen = [{ name: 'message', type: 'keyword' }];
    expect(columnOverlap(ref, gen)).toBe(1.0);
  });

  it('returns 0 for empty reference', () => {
    expect(columnOverlap([], [{ name: 'a', type: 'keyword' }])).toBe(1.0);
  });
});

describe('rowCountSimilarity', () => {
  it('returns 1.0 for identical counts', () => {
    expect(rowCountSimilarity(10, 10)).toBe(1.0);
  });

  it('returns 0.5 when generated has half the rows', () => {
    expect(rowCountSimilarity(10, 5)).toBe(0.5);
  });

  it('returns 0 when generated has zero rows and ref has rows', () => {
    expect(rowCountSimilarity(10, 0)).toBe(0);
  });

  it('handles zero reference rows', () => {
    expect(rowCountSimilarity(0, 0)).toBe(1.0);
  });
});

describe('EsqlResultEvaluator', () => {
  const evaluator = new EsqlResultEvaluator();

  it('scores 1.0 when results match exactly', async () => {
    const result = { columns: [{ name: 'a', type: 'keyword' }], values: [['x'], ['y']] };
    mockExecuteEsql.mockResolvedValue(result);

    const r = await evaluator.evaluate(
      makeContext('```esql\nFROM logs | KEEP a\n```', 'FROM logs | KEEP a'),
    );
    expect(r.score).toBe(1.0);
    expect(r.pass).toBe(true);
  });

  it('skips when no esqlGolden specified', async () => {
    const r = await evaluator.evaluate(makeContext('FROM logs'));
    expect(r.skipped).toBe(true);
  });

  it('scores 0 when generated query fails', async () => {
    let callCount = 0;
    mockExecuteEsql.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { columns: [{ name: 'a', type: 'keyword' }], values: [['x']] };
      }
      return { error: 'parse error' };
    });

    const r = await evaluator.evaluate(
      makeContext('```esql\nBAD QUERY\n```', 'FROM logs | KEEP a'),
    );
    expect(r.score).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/evaluators/esql-result.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the evaluator**

Create `src/evaluators/esql-result.ts`:

```typescript
import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { extractEsql, executeEsql, buildEsHeaders, resolveEsUrl } from './esql-utils.js';
import type { EsqlResult } from './esql-utils.js';

/**
 * Fraction of reference columns that appear in generated columns (case-insensitive).
 * Extra columns in generated output don't penalize.
 */
export function columnOverlap(
  refCols: Array<{ name: string }>,
  genCols: Array<{ name: string }>,
): number {
  if (refCols.length === 0) return 1.0;
  const genSet = new Set(genCols.map((c) => c.name.toLowerCase()));
  const overlap = refCols.filter((c) => genSet.has(c.name.toLowerCase())).length;
  return Math.round((overlap / refCols.length) * 1000) / 1000;
}

/**
 * Row count similarity: 1 - min(|genRows - refRows| / refRows, 1).
 */
export function rowCountSimilarity(refCount: number, genCount: number): number {
  if (refCount === 0 && genCount === 0) return 1.0;
  if (refCount === 0) return 0;
  return Math.round(Math.max(0, 1 - Math.abs(genCount - refCount) / refCount) * 1000) / 1000;
}

export class EsqlResultEvaluator implements Evaluator {
  name = 'esql-result';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const golden = context.expected?.esqlGolden;
    if (!golden) {
      return {
        evaluator: this.name,
        score: 0,
        pass: true,
        skipped: true,
        label: 'no_golden',
        explanation: 'No esqlGolden specified; skipping result comparison.',
      };
    }

    const esUrl = resolveEsUrl(context.config);
    if (!esUrl) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'no_es_url',
        explanation: 'No Elasticsearch URL configured',
      };
    }

    const genQuery = extractEsql(context.finalOutput ?? '');
    if (!genQuery) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'no_query',
        explanation: 'Could not extract ES|QL query from output',
      };
    }

    const headers = buildEsHeaders(context.config);

    const [refOutcome, genOutcome] = await Promise.all([
      executeEsql(golden, esUrl, headers),
      executeEsql(genQuery, esUrl, headers),
    ]);

    if ('error' in refOutcome && refOutcome.error) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'golden_error',
        explanation: `Golden query failed to execute: ${refOutcome.error}`,
        metadata: { goldenQuery: golden, error: refOutcome.error },
      };
    }

    if ('error' in genOutcome && genOutcome.error) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'gen_error',
        explanation: `Generated query failed to execute: ${genOutcome.error}`,
        metadata: { generatedQuery: genQuery, error: genOutcome.error },
      };
    }

    const ref = refOutcome as EsqlResult;
    const gen = genOutcome as EsqlResult;

    const colScore = columnOverlap(ref.columns, gen.columns);
    const rowScore = rowCountSimilarity(ref.values.length, gen.values.length);
    const score = Math.round(((colScore + rowScore) / 2) * 1000) / 1000;
    const threshold = (context.config?.['esql-result'] as number | undefined) ?? 0.7;

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= 0.9 ? 'match' : score >= 0.5 ? 'partial' : 'mismatch',
      explanation:
        `Column overlap: ${colScore} (${ref.columns.length} ref cols), ` +
        `Row similarity: ${rowScore} (ref=${ref.values.length}, gen=${gen.values.length})`,
      metadata: {
        columnOverlap: colScore,
        rowCountSimilarity: rowScore,
        refColumns: ref.columns.map((c) => c.name),
        genColumns: gen.columns.map((c) => c.name),
        refRowCount: ref.values.length,
        genRowCount: gen.values.length,
        goldenQuery: golden,
        generatedQuery: genQuery,
      },
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/evaluators/esql-result.test.ts 2>&1 | tail -10`
Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/evaluators/esql-result.ts src/evaluators/esql-result.test.ts
git commit -m "feat(esql): add esql-result evaluator comparing column overlap and row count"
```

---

### Task 6: Register evaluators in index

**Files:**
- Modify: `src/evaluators/index.ts`

Wire all three new evaluators into the registry so they can be referenced by name in YAML configs.

- [ ] **Step 1: Add imports and registration**

In `src/evaluators/index.ts`, add the three new imports after the existing imports:

```typescript
import { EsqlExecutionEvaluator } from './esql-execution.js';
import { EsqlPatternEvaluator } from './esql-pattern.js';
import { EsqlResultEvaluator } from './esql-result.js';
```

Add to `EVALUATOR_NAMES` array:

```typescript
  'esql-execution',
  'esql-pattern',
  'esql-result',
```

Add to `EVALUATOR_MAP`:

```typescript
  'esql-execution': EsqlExecutionEvaluator,
  'esql-pattern': EsqlPatternEvaluator,
  'esql-result': EsqlResultEvaluator,
```

Add to the re-exports at the bottom:

```typescript
export {
  // ... existing exports ...
  EsqlExecutionEvaluator,
  EsqlPatternEvaluator,
  EsqlResultEvaluator,
};
```

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Run full evaluator test suite**

Run: `npx vitest run src/evaluators/ 2>&1 | tail -20`
Expected: All tests PASS, including the new ones.

- [ ] **Step 4: Commit**

```bash
git add src/evaluators/index.ts
git commit -m "feat(esql): register esql-execution, esql-pattern, esql-result evaluators"
```

---

## Example YAML Usage

After implementation, an eval config using all three evaluators would look like:

```yaml
adapter: plain-llm
evaluators:
  - esql-execution    # Does it run? (0-1.0, 0.4 for index_not_found)
  - esql-pattern      # Does it use the right commands? (0-1.0)
  - esql-result       # Do the results match the golden? (0-1.0)
tests:
  - name: basic-query-accuracy
    prompt: |
      There is an Elasticsearch index called `logs-test` that contains
      application logs. Retrieve the 10 most recent log entries showing
      @timestamp, level, and message, sorted by @timestamp descending.
      Write only the ES|QL query.
    expected:
      response_contains:   # Used by esql-pattern as criteria
        - "KEEP"
        - "SORT.*DESC"
        - "LIMIT 10"
      esql_golden: |       # Used by esql-result for result comparison
        FROM logs-test
        | KEEP @timestamp, level, message
        | SORT @timestamp DESC
        | LIMIT 10
    repetitions: 5
```
