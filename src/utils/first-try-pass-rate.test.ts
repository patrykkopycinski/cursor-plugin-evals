import { describe, it, expect } from 'vitest';
import { computeFirstTryPassRate, type FirstTryStats } from './first-try-pass-rate.js';
import type { TestResult } from '../core/types.js';

function makeResult(name: string, pass: boolean, repetition = 1, score = pass ? 1 : 0): TestResult {
  return {
    name,
    suite: 'test-suite',
    layer: 'llm',
    pass,
    toolCalls: [],
    evaluatorResults: [{ evaluator: 'correctness', score, pass, label: pass ? 'CORRECT' : 'WRONG' }],
    latencyMs: 100,
    repetition,
  };
}

describe('computeFirstTryPassRate', () => {
  it('returns 0 for empty results', () => {
    const stats = computeFirstTryPassRate([]);
    expect(stats.firstTryPassRate).toBe(0);
    expect(stats.firstTryTotal).toBe(0);
  });

  it('computes 100% when all pass on first try', () => {
    const results = [makeResult('a', true), makeResult('b', true)];
    const stats = computeFirstTryPassRate(results);
    expect(stats.firstTryPassRate).toBe(1.0);
    expect(stats.firstTryPassed).toBe(2);
    expect(stats.firstTryTotal).toBe(2);
  });

  it('computes 50% when half pass on first try', () => {
    const results = [makeResult('a', true), makeResult('b', false)];
    const stats = computeFirstTryPassRate(results);
    expect(stats.firstTryPassRate).toBe(0.5);
  });

  it('uses only the first repetition for multi-attempt tests', () => {
    const results = [
      makeResult('a', false, 1),
      makeResult('a', true, 2),
      makeResult('a', true, 3),
    ];
    const stats = computeFirstTryPassRate(results);
    expect(stats.firstTryPassRate).toBe(0);
    expect(stats.testBreakdown).toHaveLength(1);
    expect(stats.testBreakdown[0].passedFirstTry).toBe(false);
  });

  it('handles mixed repetitions across tests', () => {
    const results = [
      makeResult('a', true, 1),
      makeResult('a', true, 2),
      makeResult('b', false, 1),
      makeResult('b', true, 2),
    ];
    const stats = computeFirstTryPassRate(results);
    expect(stats.firstTryPassRate).toBe(0.5);
    expect(stats.firstTryPassed).toBe(1);
    expect(stats.firstTryTotal).toBe(2);
  });

  it('includes score breakdown per test', () => {
    const results = [makeResult('a', true, 1, 0.9), makeResult('b', false, 1, 0.3)];
    const stats = computeFirstTryPassRate(results);
    expect(stats.testBreakdown).toHaveLength(2);
    expect(stats.testBreakdown.find((b) => b.name === 'a')?.firstTryScore).toBe(0.9);
    expect(stats.testBreakdown.find((b) => b.name === 'b')?.firstTryScore).toBe(0.3);
  });
});
