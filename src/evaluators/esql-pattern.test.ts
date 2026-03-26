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
