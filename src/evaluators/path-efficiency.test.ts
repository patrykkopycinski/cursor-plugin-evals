import { describe, it, expect } from 'vitest';
import { PathEfficiencyEvaluator, lcsLength } from './path-efficiency.js';
import type { EvaluatorContext, ToolCallRecord } from '../core/types.js';

function makeToolCall(tool: string): ToolCallRecord {
  return {
    tool,
    args: {},
    result: { content: [{ type: 'text', text: '' }] },
    latencyMs: 0,
  };
}

function makeContext(
  goldenPath: string[] | undefined,
  actualToolCalls: ToolCallRecord[],
  config?: Record<string, unknown>,
): EvaluatorContext {
  return {
    testName: 'test',
    toolCalls: actualToolCalls,
    expected: goldenPath ? { goldenPath } : undefined,
    config,
  };
}

describe('lcsLength', () => {
  it('returns 0 for empty arrays', () => {
    expect(lcsLength([], [])).toBe(0);
    expect(lcsLength(['a'], [])).toBe(0);
    expect(lcsLength([], ['a'])).toBe(0);
  });

  it('returns full length for identical arrays', () => {
    expect(lcsLength(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(3);
  });

  it('finds subsequence in longer array', () => {
    expect(lcsLength(['a', 'b', 'c'], ['x', 'a', 'y', 'b', 'z', 'c'])).toBe(3);
  });

  it('returns 0 for completely disjoint arrays', () => {
    expect(lcsLength(['a', 'b'], ['x', 'y'])).toBe(0);
  });

  it('handles partial overlap', () => {
    expect(lcsLength(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(2);
  });
});

describe('PathEfficiencyEvaluator', () => {
  const evaluator = new PathEfficiencyEvaluator();

  it('returns 1.0 when no golden path is specified', async () => {
    const ctx = makeContext(undefined, [makeToolCall('a')]);
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('skip');
  });

  it('returns 1.0 when golden path is empty', async () => {
    const ctx = makeContext([], [makeToolCall('a')]);
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('returns 0 when no tool calls made', async () => {
    const ctx = makeContext(['a', 'b'], []);
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
  });

  it('scores 1.0 on exact match (coverage=1, efficiency=1)', async () => {
    const golden = ['tool_a', 'tool_b', 'tool_c'];
    const ctx = makeContext(golden, golden.map(makeToolCall));
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('penalizes extra unnecessary calls (efficiency < 1)', async () => {
    const golden = ['tool_a', 'tool_b'];
    const ctx = makeContext(golden, ['tool_a', 'tool_x', 'tool_b', 'tool_y'].map(makeToolCall));
    const result = await evaluator.evaluate(ctx);

    // coverage = LCS(actual, golden)/len(golden) = 2/2 = 1.0
    // efficiency = len(golden)/len(actual) = 2/4 = 0.5
    // composite = 0.6*1.0 + 0.4*0.5 = 0.8
    expect(result.score).toBeCloseTo(0.8, 3);
    expect(result.metadata?.coverage).toBe(1.0);
    expect(result.metadata?.efficiency).toBe(0.5);
  });

  it('penalizes missing golden steps (coverage < 1)', async () => {
    const golden = ['tool_a', 'tool_b', 'tool_c'];
    const ctx = makeContext(golden, [makeToolCall('tool_a')]);
    const result = await evaluator.evaluate(ctx);

    // coverage = 1/3 ≈ 0.333
    // efficiency = 3/1 = 3 → capped at value since ratio can exceed 1
    // composite = 0.6*0.333 + 0.4*3.0 = 0.2 + 1.2 = 1.4 → rounds to 1.4
    const expectedCoverage = 1 / 3;
    const expectedEfficiency = 3 / 1;
    const expectedComposite = 0.6 * expectedCoverage + 0.4 * expectedEfficiency;
    expect(result.score).toBeCloseTo(expectedComposite, 2);
    expect(result.metadata?.coverage).toBeCloseTo(expectedCoverage, 3);
  });

  it('uses configurable threshold', async () => {
    const golden = ['a', 'b'];
    const ctx = makeContext(golden, ['a', 'b', 'c', 'd', 'e', 'f'].map(makeToolCall), {
      threshold: 0.9,
    });
    const result = await evaluator.evaluate(ctx);
    // efficiency = 2/6 ≈ 0.333
    // composite = 0.6*1.0 + 0.4*0.333 = 0.733
    expect(result.pass).toBe(false);
  });

  it('uses configurable weights', async () => {
    const golden = ['a', 'b'];
    const ctx = makeContext(golden, ['a', 'b', 'c', 'd'].map(makeToolCall), {
      coverageWeight: 0.5,
      efficiencyWeight: 0.5,
      threshold: 0,
    });
    const result = await evaluator.evaluate(ctx);
    // coverage=1.0, efficiency=0.5
    // composite with 50/50 = 0.5*1.0 + 0.5*0.5 = 0.75
    expect(result.score).toBeCloseTo(0.75, 3);
  });

  it('handles superset actual path matching all golden steps', async () => {
    const golden = ['a', 'b'];
    const ctx = makeContext(golden, ['x', 'a', 'y', 'b', 'z'].map(makeToolCall));
    const result = await evaluator.evaluate(ctx);
    expect(result.metadata?.coverage).toBe(1.0);
    expect(result.metadata?.efficiency).toBeCloseTo(2 / 5, 3);
  });
});
