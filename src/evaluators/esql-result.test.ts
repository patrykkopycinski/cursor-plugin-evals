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

  it('returns 1.0 for empty reference', () => {
    expect(columnOverlap([], [{ name: 'a', type: 'keyword' }])).toBe(1.0);
  });
});

describe('rowCountSimilarity', () => {
  it('returns 1.0 for identical counts', () => {
    expect(rowCountSimilarity(10, 10)).toBe(1.0);
  });

  it('is forgiving when generated has half the rows (log-scale)', () => {
    // Log-scale: 1 - |log(6) - log(11)| / log(11) ≈ 0.747
    expect(rowCountSimilarity(10, 5)).toBe(0.747);
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
