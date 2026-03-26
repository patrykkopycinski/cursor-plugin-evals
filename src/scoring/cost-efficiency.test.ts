import { describe, it, expect } from 'vitest';
import { computeCostEfficiency } from './cost-efficiency.js';
import type { RunResult } from '../core/types.js';

function makeRun(passRate: number, costUsd: number): RunResult {
  return {
    runId: 'test', timestamp: '', config: '',
    suites: [{
      name: 's', layer: 'llm',
      tests: [{ name: 't', suite: 's', layer: 'llm', pass: passRate >= 0.5, toolCalls: [], evaluatorResults: [{ evaluator: 'correctness', score: passRate, pass: passRate >= 0.5 }], latencyMs: 100, costUsd }],
      passRate, duration: 100, evaluatorSummary: {},
    }],
    overall: { total: 1, passed: passRate >= 0.5 ? 1 : 0, failed: passRate < 0.5 ? 1 : 0, skipped: 0, passRate, duration: 100 },
  };
}

describe('computeCostEfficiency', () => {
  it('scores high for high quality + low cost', () => {
    const score = computeCostEfficiency(makeRun(0.95, 0.001));
    expect(score.score).toBeGreaterThan(80);
    expect(score.grade).toBe('A');
  });

  it('scores low for low quality', () => {
    const score = computeCostEfficiency(makeRun(0.2, 0.001));
    expect(score.score).toBeLessThan(40);
  });

  it('penalizes high cost', () => {
    const cheap = computeCostEfficiency(makeRun(0.9, 0.001));
    const expensive = computeCostEfficiency(makeRun(0.9, 1.0));
    expect(cheap.score).toBeGreaterThan(expensive.score);
  });

  it('returns 0 for zero quality', () => {
    const score = computeCostEfficiency(makeRun(0, 0.5));
    expect(score.score).toBe(0);
  });

  it('includes breakdown', () => {
    const score = computeCostEfficiency(makeRun(0.8, 0.05));
    expect(score.qualityScore).toBeCloseTo(0.8, 1);
    expect(score.costUsd).toBe(0.05);
    expect(typeof score.costPerQualityPoint).toBe('number');
  });

  it('grades correctly at boundaries', () => {
    expect(computeCostEfficiency(makeRun(0.91, 0)).grade).toBe('A');
    expect(computeCostEfficiency(makeRun(0.81, 0)).grade).toBe('B');
    expect(computeCostEfficiency(makeRun(0.71, 0)).grade).toBe('C');
    expect(computeCostEfficiency(makeRun(0.61, 0)).grade).toBe('D');
    expect(computeCostEfficiency(makeRun(0.5, 0)).grade).toBe('F');
  });
});
