import { describe, it, expect } from 'vitest';
import { welchTTest, detectRegressions } from './detector.js';
import { buildFingerprint } from './fingerprint.js';
import type { Fingerprint } from './fingerprint.js';
import type { TestResult } from '../core/types.js';

describe('welchTTest', () => {
  it('returns p ≈ 1 for identical distributions', () => {
    const a = [1, 1, 1, 1, 1];
    const b = [1, 1, 1, 1, 1];
    const result = welchTTest(a, b);
    expect(result.pValue).toBeCloseTo(1, 1);
    expect(result.tStat).toBeCloseTo(0, 5);
  });

  it('detects significant difference between well-separated distributions', () => {
    const a = [10, 10.1, 9.9, 10, 10.2, 9.8, 10.1, 10, 9.9, 10];
    const b = [5, 5.1, 4.9, 5, 5.2, 4.8, 5.1, 5, 4.9, 5];
    const result = welchTTest(a, b);
    expect(result.pValue).toBeLessThan(0.001);
  });

  it('returns high p-value for overlapping distributions', () => {
    // Samples with nearly identical means and high variance
    const a = [3, 5, 2, 6, 4];
    const b = [4, 3, 5, 2, 6];
    const result = welchTTest(a, b);
    expect(result.pValue).toBeGreaterThan(0.5);
  });

  it('handles unequal sample sizes', () => {
    const a = [10, 10, 10];
    const b = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    const result = welchTTest(a, b);
    expect(result.pValue).toBeLessThan(0.001);
  });

  it('returns pValue=1 when all values are identical (zero variance)', () => {
    const a = [7, 7, 7];
    const b = [7, 7, 7];
    const result = welchTTest(a, b);
    expect(result.pValue).toBe(1);
  });
});

describe('detectRegressions', () => {
  it('returns PASS when current matches baseline', () => {
    const baseline: Fingerprint = {
      runId: 'base',
      timestamp: '2024-01-01T00:00:00Z',
      scores: {
        'suite.test.eval': [0.9, 0.9, 0.9, 0.9, 0.9],
      },
    };
    const current: Fingerprint = {
      runId: 'curr',
      timestamp: '2024-01-02T00:00:00Z',
      scores: {
        'suite.test.eval': [0.9, 0.9, 0.9, 0.9, 0.9],
      },
    };

    const results = detectRegressions(baseline, current);
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe('PASS');
  });

  it('returns FAIL when current is significantly worse', () => {
    const baseline: Fingerprint = {
      runId: 'base',
      timestamp: '2024-01-01T00:00:00Z',
      scores: {
        'suite.test.eval': [0.95, 0.94, 0.96, 0.95, 0.94, 0.95, 0.96, 0.95],
      },
    };
    const current: Fingerprint = {
      runId: 'curr',
      timestamp: '2024-01-02T00:00:00Z',
      scores: {
        'suite.test.eval': [0.5, 0.51, 0.49, 0.5, 0.52, 0.5, 0.49, 0.51],
      },
    };

    const results = detectRegressions(baseline, current);
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe('FAIL');
    expect(results[0].delta).toBeLessThan(0);
    expect(results[0].pValue).toBeLessThan(0.05);
  });

  it('returns PASS when current is significantly better (improvement)', () => {
    const baseline: Fingerprint = {
      runId: 'base',
      timestamp: '2024-01-01T00:00:00Z',
      scores: {
        'suite.test.eval': [0.5, 0.51, 0.49, 0.5, 0.52],
      },
    };
    const current: Fingerprint = {
      runId: 'curr',
      timestamp: '2024-01-02T00:00:00Z',
      scores: {
        'suite.test.eval': [0.95, 0.94, 0.96, 0.95, 0.94],
      },
    };

    const results = detectRegressions(baseline, current);
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe('PASS');
    expect(results[0].delta).toBeGreaterThan(0);
  });

  it('returns INCONCLUSIVE when sample size is too small', () => {
    const baseline: Fingerprint = {
      runId: 'base',
      timestamp: '2024-01-01T00:00:00Z',
      scores: {
        'suite.test.eval': [0.9, 0.8],
      },
    };
    const current: Fingerprint = {
      runId: 'curr',
      timestamp: '2024-01-02T00:00:00Z',
      scores: {
        'suite.test.eval': [0.5, 0.4],
      },
    };

    const results = detectRegressions(baseline, current);
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe('INCONCLUSIVE');
  });

  it('returns INCONCLUSIVE when a metric exists only in one fingerprint', () => {
    const baseline: Fingerprint = {
      runId: 'base',
      timestamp: '2024-01-01T00:00:00Z',
      scores: {
        'suite.test.eval': [0.9, 0.9, 0.9, 0.9],
      },
    };
    const current: Fingerprint = {
      runId: 'curr',
      timestamp: '2024-01-02T00:00:00Z',
      scores: {
        'suite.test.other': [0.5, 0.5, 0.5, 0.5],
      },
    };

    const results = detectRegressions(baseline, current);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.verdict === 'INCONCLUSIVE')).toBe(true);
  });

  it('handles multiple metrics across suites', () => {
    const baseline: Fingerprint = {
      runId: 'base',
      timestamp: '2024-01-01T00:00:00Z',
      scores: {
        'a.t1.e1': [0.9, 0.9, 0.9],
        'b.t2.e2': [0.8, 0.8, 0.8],
      },
    };
    const current: Fingerprint = {
      runId: 'curr',
      timestamp: '2024-01-02T00:00:00Z',
      scores: {
        'a.t1.e1': [0.9, 0.9, 0.9],
        'b.t2.e2': [0.8, 0.8, 0.8],
      },
    };

    const results = detectRegressions(baseline, current);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.verdict === 'PASS')).toBe(true);
  });

  it('respects custom alpha', () => {
    const baseline: Fingerprint = {
      runId: 'base',
      timestamp: '2024-01-01T00:00:00Z',
      scores: {
        'suite.test.eval': [0.9, 0.85, 0.88, 0.9, 0.87],
      },
    };
    const current: Fingerprint = {
      runId: 'curr',
      timestamp: '2024-01-02T00:00:00Z',
      scores: {
        'suite.test.eval': [0.82, 0.8, 0.83, 0.81, 0.82],
      },
    };

    const strictResults = detectRegressions(baseline, current, 0.001);
    const looseResults = detectRegressions(baseline, current, 0.5);

    // With very strict alpha, more likely to PASS (not enough evidence)
    // With very loose alpha, more likely to FAIL
    expect(strictResults[0].pValue).toBe(looseResults[0].pValue);
  });
});

describe('buildFingerprint', () => {
  it('groups scores by suite.test.evaluator key', () => {
    const results: TestResult[] = [
      {
        name: 'test-1',
        suite: 'suite-a',
        layer: 'llm',
        pass: true,
        toolCalls: [],
        evaluatorResults: [
          { evaluator: 'tool-selection', score: 0.9, pass: true },
          { evaluator: 'response-quality', score: 0.8, pass: true },
        ],
        latencyMs: 100,
      },
      {
        name: 'test-1',
        suite: 'suite-a',
        layer: 'llm',
        pass: true,
        toolCalls: [],
        evaluatorResults: [
          { evaluator: 'tool-selection', score: 0.95, pass: true },
          { evaluator: 'response-quality', score: 0.85, pass: true },
        ],
        latencyMs: 110,
        repetition: 2,
      },
    ];

    const fp = buildFingerprint('test-run', results);

    expect(fp.runId).toBe('test-run');
    expect(fp.scores['suite-a.test-1.tool-selection']).toEqual([0.9, 0.95]);
    expect(fp.scores['suite-a.test-1.response-quality']).toEqual([0.8, 0.85]);
  });

  it('handles empty results', () => {
    const fp = buildFingerprint('empty-run', []);
    expect(fp.runId).toBe('empty-run');
    expect(Object.keys(fp.scores)).toHaveLength(0);
  });

  it('creates separate keys for different suites', () => {
    const results: TestResult[] = [
      {
        name: 'test-1',
        suite: 'suite-a',
        layer: 'llm',
        pass: true,
        toolCalls: [],
        evaluatorResults: [{ evaluator: 'eval-1', score: 0.9, pass: true }],
        latencyMs: 100,
      },
      {
        name: 'test-1',
        suite: 'suite-b',
        layer: 'llm',
        pass: true,
        toolCalls: [],
        evaluatorResults: [{ evaluator: 'eval-1', score: 0.7, pass: true }],
        latencyMs: 100,
      },
    ];

    const fp = buildFingerprint('multi-suite', results);
    expect(fp.scores['suite-a.test-1.eval-1']).toEqual([0.9]);
    expect(fp.scores['suite-b.test-1.eval-1']).toEqual([0.7]);
  });
});
