import { describe, it, expect } from 'vitest';
import { evaluateCi, convertFlatThresholds } from './index.js';
import type { TestResult, CiThresholds } from '../core/types.js';

function makeTest(overrides: Partial<TestResult> = {}): TestResult {
  return {
    name: 'test-1',
    suite: 'suite-1',
    layer: 'llm',
    pass: true,
    toolCalls: [],
    evaluatorResults: [{ evaluator: 'correctness', score: 0.9, pass: true }],
    latencyMs: 500,
    ...overrides,
  };
}

describe('evaluateCi', () => {
  it('returns passed when no thresholds configured', () => {
    const result = evaluateCi([makeTest()], {});
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.summary).toBe('All CI thresholds passed');
  });

  it('returns passed when all scores above threshold', () => {
    const result = evaluateCi(
      [makeTest({ evaluatorResults: [{ evaluator: 'correctness', score: 0.9, pass: true }] })],
      { score: { avg: 0.8 } },
    );
    expect(result.passed).toBe(true);
  });

  it('detects score avg below threshold', () => {
    const result = evaluateCi(
      [makeTest({ evaluatorResults: [{ evaluator: 'correctness', score: 0.5, pass: false }] })],
      { score: { avg: 0.8 } },
    );
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].metric).toBe('score.avg');
    expect(result.violations[0].actual).toBeCloseTo(0.5);
    expect(result.violations[0].threshold).toBe(0.8);
  });

  it('detects score p95 below threshold', () => {
    const tests = Array.from({ length: 20 }, (_, i) =>
      makeTest({
        name: `test-${i}`,
        evaluatorResults: [{ evaluator: 'correctness', score: 0.5, pass: false }],
      }),
    );
    const result = evaluateCi(tests, { score: { p95: 0.85 } });
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.metric === 'score.p95')).toBe(true);
  });

  it('detects latency avg above threshold', () => {
    const result = evaluateCi([makeTest({ latencyMs: 5000 }), makeTest({ latencyMs: 6000 })], {
      latency: { avg: 4000 },
    });
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].metric).toBe('latency.avg');
    expect(result.violations[0].actual).toBe(5500);
    expect(result.summary).toContain('>');
  });

  it('detects latency p95 above threshold', () => {
    const tests = Array.from({ length: 20 }, (_, i) =>
      makeTest({ name: `test-${i}`, latencyMs: i >= 18 ? 10000 : 100 }),
    );
    const result = evaluateCi(tests, { latency: { p95: 500 } });
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.metric === 'latency.p95')).toBe(true);
  });

  it('passes latency when within threshold', () => {
    const result = evaluateCi([makeTest({ latencyMs: 200 }), makeTest({ latencyMs: 300 })], {
      latency: { avg: 1000, p95: 5000 },
    });
    expect(result.passed).toBe(true);
  });

  it('detects cost total above threshold', () => {
    const result = evaluateCi([makeTest({ costUsd: 0.5 }), makeTest({ costUsd: 0.6 })], {
      cost: { max: 1.0 },
    });
    expect(result.passed).toBe(false);
    expect(result.violations[0].metric).toBe('cost.total');
    expect(result.violations[0].actual).toBeCloseTo(1.1);
    expect(result.summary).toContain('>');
  });

  it('passes cost when within threshold', () => {
    const result = evaluateCi([makeTest({ costUsd: 0.1 }), makeTest({ costUsd: 0.2 })], {
      cost: { max: 1.0 },
    });
    expect(result.passed).toBe(true);
  });

  it('handles per-evaluator thresholds', () => {
    const result = evaluateCi(
      [
        makeTest({
          evaluatorResults: [
            { evaluator: 'correctness', score: 0.9, pass: true },
            { evaluator: 'groundedness', score: 0.4, pass: false },
          ],
        }),
      ],
      { evaluators: { correctness: { avg: 0.8 }, groundedness: { avg: 0.7 } } },
    );
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].metric).toBe('evaluators.groundedness.avg');
  });

  it('ignores per-evaluator thresholds for missing evaluators', () => {
    const result = evaluateCi(
      [makeTest({ evaluatorResults: [{ evaluator: 'correctness', score: 0.9, pass: true }] })],
      { evaluators: { 'nonexistent-eval': { avg: 0.8 } } },
    );
    expect(result.passed).toBe(true);
  });

  it('detects multiple violations across score, latency, and cost', () => {
    const result = evaluateCi(
      [
        makeTest({
          evaluatorResults: [{ evaluator: 'x', score: 0.3, pass: false }],
          latencyMs: 10000,
          costUsd: 5.0,
        }),
      ],
      { score: { avg: 0.8 }, latency: { avg: 2000 }, cost: { max: 1.0 } },
    );
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });

  it('handles empty test array', () => {
    const result = evaluateCi([], { score: { avg: 0.8 }, latency: { avg: 1000 } });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('handles tests with no evaluator results', () => {
    const result = evaluateCi([makeTest({ evaluatorResults: [] })], { score: { avg: 0.8 } });
    expect(result.passed).toBe(true);
  });

  it('summary uses < for score violations and > for latency violations', () => {
    const result = evaluateCi(
      [
        makeTest({
          evaluatorResults: [{ evaluator: 'x', score: 0.3, pass: false }],
          latencyMs: 10000,
        }),
      ],
      { score: { avg: 0.8 }, latency: { avg: 2000 } },
    );
    expect(result.summary).toContain('score.avg (0.300 < 0.8)');
    expect(result.summary).toContain('latency.avg (10000.000 > 2000)');
  });
});

describe('convertFlatThresholds', () => {
  it('converts flat map to evaluator thresholds', () => {
    const result = convertFlatThresholds({ correctness: 0.8, groundedness: 0.7 });
    expect(result).toEqual({
      evaluators: {
        correctness: { avg: 0.8 },
        groundedness: { avg: 0.7 },
      },
    });
  });

  it('handles empty input', () => {
    const result = convertFlatThresholds({});
    expect(result).toEqual({ evaluators: {} });
  });
});
