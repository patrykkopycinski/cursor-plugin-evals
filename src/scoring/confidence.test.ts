import { describe, it, expect } from 'vitest';
import {
  computeConfidenceInterval,
  aggregateConfidence,
  confidenceGatingPass,
} from './confidence.js';
import type { ConfidenceInterval } from '../core/types.js';

describe('computeConfidenceInterval', () => {
  it('returns zeroes for empty array', () => {
    const ci = computeConfidenceInterval([]);
    expect(ci.mean).toBe(0);
    expect(ci.stddev).toBe(0);
    expect(ci.lowerBound).toBe(0);
    expect(ci.upperBound).toBe(0);
    expect(ci.sampleSize).toBe(0);
  });

  it('returns exact value for single sample', () => {
    const ci = computeConfidenceInterval([0.85]);
    expect(ci.mean).toBe(0.85);
    expect(ci.stddev).toBe(0);
    expect(ci.lowerBound).toBe(0.85);
    expect(ci.upperBound).toBe(0.85);
    expect(ci.sampleSize).toBe(1);
  });

  it('computes correct mean', () => {
    const ci = computeConfidenceInterval([0.8, 0.9, 0.7]);
    expect(ci.mean).toBeCloseTo(0.8, 3);
    expect(ci.sampleSize).toBe(3);
  });

  it('computes correct stddev with Bessel correction', () => {
    const scores = [0.8, 0.9, 0.7];
    const ci = computeConfidenceInterval(scores);
    const mean = 0.8;
    const variance = ((0.8 - mean) ** 2 + (0.9 - mean) ** 2 + (0.7 - mean) ** 2) / 2;
    expect(ci.stddev).toBeCloseTo(Math.sqrt(variance), 3);
  });

  it('computes 95% CI bounds for known dataset', () => {
    const scores = [0.8, 0.9, 0.7, 0.85, 0.75];
    const ci = computeConfidenceInterval(scores);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / (scores.length - 1);
    const stddev = Math.sqrt(variance);
    const margin = 1.96 * (stddev / Math.sqrt(scores.length));

    expect(ci.mean).toBeCloseTo(mean, 3);
    expect(ci.lowerBound).toBeCloseTo(Math.max(0, mean - margin), 3);
    expect(ci.upperBound).toBeCloseTo(Math.min(1, mean + margin), 3);
  });

  it('clamps lower bound to 0', () => {
    const ci = computeConfidenceInterval([0.01, 0.02, 0.0]);
    expect(ci.lowerBound).toBeGreaterThanOrEqual(0);
  });

  it('clamps upper bound to 1', () => {
    const ci = computeConfidenceInterval([0.99, 0.98, 1.0]);
    expect(ci.upperBound).toBeLessThanOrEqual(1);
  });

  it('supports 90% confidence level', () => {
    const scores = [0.8, 0.9, 0.7, 0.85, 0.75];
    const ci90 = computeConfidenceInterval(scores, 0.9);
    const ci95 = computeConfidenceInterval(scores, 0.95);
    expect(ci90.upperBound - ci90.lowerBound).toBeLessThan(ci95.upperBound - ci95.lowerBound);
  });

  it('supports 99% confidence level', () => {
    const scores = [0.8, 0.9, 0.7, 0.85, 0.75];
    const ci99 = computeConfidenceInterval(scores, 0.99);
    const ci95 = computeConfidenceInterval(scores, 0.95);
    expect(ci99.upperBound - ci99.lowerBound).toBeGreaterThan(ci95.upperBound - ci95.lowerBound);
  });

  it('narrows interval with more samples', () => {
    const few = computeConfidenceInterval([0.8, 0.9, 0.7]);
    const many = computeConfidenceInterval([
      0.8, 0.9, 0.7, 0.85, 0.75, 0.82, 0.88, 0.78, 0.83, 0.87,
    ]);
    const fewWidth = few.upperBound - few.lowerBound;
    const manyWidth = many.upperBound - many.lowerBound;
    expect(manyWidth).toBeLessThan(fewWidth);
  });
});

describe('aggregateConfidence', () => {
  it('computes overall CI', () => {
    const entries = [
      { score: 0.9, evaluator: 'tool-selection', model: 'gpt-4o' },
      { score: 0.8, evaluator: 'tool-selection', model: 'gpt-4o' },
      { score: 0.7, evaluator: 'response-quality', model: 'claude-3' },
    ];
    const result = aggregateConfidence(entries);
    expect(result.overall.sampleSize).toBe(3);
    expect(result.overall.mean).toBeCloseTo(0.8, 3);
  });

  it('computes per-evaluator CI', () => {
    const entries = [
      { score: 0.9, evaluator: 'tool-selection' },
      { score: 0.8, evaluator: 'tool-selection' },
      { score: 0.7, evaluator: 'response-quality' },
      { score: 0.6, evaluator: 'response-quality' },
    ];
    const result = aggregateConfidence(entries);
    expect(result.byEvaluator['tool-selection'].mean).toBeCloseTo(0.85, 3);
    expect(result.byEvaluator['response-quality'].mean).toBeCloseTo(0.65, 3);
  });

  it('computes per-model CI', () => {
    const entries = [
      { score: 0.9, model: 'gpt-4o' },
      { score: 0.8, model: 'gpt-4o' },
      { score: 0.7, model: 'claude-3' },
      { score: 0.6, model: 'claude-3' },
    ];
    const result = aggregateConfidence(entries);
    expect(result.byModel['gpt-4o'].mean).toBeCloseTo(0.85, 3);
    expect(result.byModel['claude-3'].mean).toBeCloseTo(0.65, 3);
  });

  it('handles entries without evaluator or model', () => {
    const entries = [{ score: 0.9 }, { score: 0.8 }];
    const result = aggregateConfidence(entries);
    expect(result.overall.sampleSize).toBe(2);
    expect(Object.keys(result.byEvaluator)).toHaveLength(0);
    expect(Object.keys(result.byModel)).toHaveLength(0);
  });
});

describe('confidenceGatingPass', () => {
  it('passes when lower bound meets threshold', () => {
    const ci: ConfidenceInterval = {
      mean: 0.85,
      stddev: 0.05,
      lowerBound: 0.8,
      upperBound: 0.9,
      sampleSize: 10,
    };
    expect(confidenceGatingPass(ci, 0.8)).toBe(true);
  });

  it('fails when lower bound is below threshold', () => {
    const ci: ConfidenceInterval = {
      mean: 0.85,
      stddev: 0.1,
      lowerBound: 0.75,
      upperBound: 0.95,
      sampleSize: 5,
    };
    expect(confidenceGatingPass(ci, 0.8)).toBe(false);
  });

  it('is more conservative than mean-based gating', () => {
    const ci: ConfidenceInterval = {
      mean: 0.82,
      stddev: 0.08,
      lowerBound: 0.78,
      upperBound: 0.86,
      sampleSize: 10,
    };
    const meanPasses = ci.mean >= 0.8;
    const ciPasses = confidenceGatingPass(ci, 0.8);
    expect(meanPasses).toBe(true);
    expect(ciPasses).toBe(false);
  });
});
