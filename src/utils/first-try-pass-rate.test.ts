import { describe, it, expect } from 'vitest';
import { computeFirstTryPassRate, computeTrialMetrics, type FirstTryStats } from './first-try-pass-rate.js';
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

describe('computeTrialMetrics', () => {
  it('returns zero metrics for empty results', () => {
    const metrics = computeTrialMetrics([]);
    expect(metrics.perTrialSuccessRate).toBe(0);
    expect(metrics.kValues).toEqual([1, 10]);
    for (const k of metrics.kValues) {
      expect(metrics.passAtK[k]).toBe(0);
      expect(metrics.passHatK[k]).toBe(0);
    }
  });

  it('computes correct metrics for 3 tests × 5 repetitions at 80% success rate', () => {
    // 3 tests, 5 reps each, 4 out of 5 pass = 80% per test => p = 0.8
    const results: TestResult[] = [];
    for (const name of ['test-a', 'test-b', 'test-c']) {
      for (let rep = 1; rep <= 5; rep++) {
        results.push(makeResult(name, rep <= 4, rep)); // first 4 pass, 5th fails
      }
    }

    const metrics = computeTrialMetrics(results, [1, 5, 10]);

    expect(metrics.perTrialSuccessRate).toBeCloseTo(0.8, 10);
    expect(metrics.kValues).toEqual([1, 5, 10]);

    // pass@k = 1 - (1 - p)^k
    expect(metrics.passAtK[1]).toBeCloseTo(1 - Math.pow(0.2, 1), 10);
    expect(metrics.passAtK[5]).toBeCloseTo(1 - Math.pow(0.2, 5), 10);
    expect(metrics.passAtK[10]).toBeCloseTo(1 - Math.pow(0.2, 10), 10);

    // pass^k = p^k
    expect(metrics.passHatK[1]).toBeCloseTo(Math.pow(0.8, 1), 10);
    expect(metrics.passHatK[5]).toBeCloseTo(Math.pow(0.8, 5), 10);
    expect(metrics.passHatK[10]).toBeCloseTo(Math.pow(0.8, 10), 10);
  });

  it('handles single repetition (no repetition field)', () => {
    // makeResult defaults repetition = 1
    const results = [
      makeResult('a', true),
      makeResult('b', false),
      makeResult('c', true),
    ];

    const metrics = computeTrialMetrics(results, [1, 10]);

    // p = (1 + 0 + 1) / 3 ≈ 0.667
    expect(metrics.perTrialSuccessRate).toBeCloseTo(2 / 3, 10);
    expect(metrics.kValues).toEqual([1, 10]);
    expect(metrics.passAtK[1]).toBeCloseTo(1 - Math.pow(1 / 3, 1), 10);
    expect(metrics.passHatK[1]).toBeCloseTo(Math.pow(2 / 3, 1), 10);
  });

  it('deduplicates and sorts kValues', () => {
    const results = [makeResult('a', true)];
    const metrics = computeTrialMetrics(results, [10, 1, 5, 1, 10]);
    expect(metrics.kValues).toEqual([1, 5, 10]);
  });

  it('uses default kValues [1, maxReps, 10] when not provided', () => {
    const results = [
      makeResult('a', true, 1),
      makeResult('a', true, 2),
      makeResult('a', true, 3),
    ];
    const metrics = computeTrialMetrics(results);
    // maxReps = 3, so default kValues = [1, 3, 10]
    expect(metrics.kValues).toEqual([1, 3, 10]);
  });
});
