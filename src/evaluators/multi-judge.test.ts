import { describe, it, expect } from 'vitest';
import type { JudgeVerdict, MultiJudgeConfig } from './multi-judge.js';
import {
  aggregateByBordaCount,
  aggregateByMajorityVote,
  aggregateByWeightedAverage,
  aggregateByMedian,
  computeAgreement,
  runMultiJudgeEvaluation,
} from './multi-judge.js';

function makeVerdict(overrides: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return {
    judgeModel: 'gpt-4o',
    score: 0.8,
    label: 'GOOD',
    explanation: 'Looks good',
    latencyMs: 500,
    costUsd: 0.01,
    ...overrides,
  };
}

describe('aggregateByBordaCount', () => {
  it('ranks 3 judges with equal weights', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ judgeModel: 'gpt-4o', score: 0.9 }),
      makeVerdict({ judgeModel: 'claude', score: 0.7 }),
      makeVerdict({ judgeModel: 'gemini', score: 0.5 }),
    ];

    const result = aggregateByBordaCount(verdicts);
    expect(result).toBeCloseTo(0.5, 5);
  });

  it('applies 2x weight for supreme judge', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ judgeModel: 'gpt-4o', score: 0.9 }),
      makeVerdict({ judgeModel: 'claude', score: 0.7 }),
      makeVerdict({ judgeModel: 'gemini', score: 0.5 }),
    ];

    const weights = new Map([
      ['gpt-4o', 2],
      ['claude', 1],
      ['gemini', 1],
    ]);

    const result = aggregateByBordaCount(verdicts, weights);
    expect(result).toBeCloseTo(5 / 8, 5);
  });

  it('returns the score for a single judge', () => {
    const verdicts: JudgeVerdict[] = [makeVerdict({ judgeModel: 'gpt-4o', score: 0.75 })];
    expect(aggregateByBordaCount(verdicts)).toBe(0.75);
  });

  it('returns 0 for empty verdicts', () => {
    expect(aggregateByBordaCount([])).toBe(0);
  });
});

describe('aggregateByWeightedAverage', () => {
  it('computes weighted average with custom weights', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ judgeModel: 'gpt-4o', score: 0.9 }),
      makeVerdict({ judgeModel: 'claude', score: 0.6 }),
    ];
    const weights = new Map([
      ['gpt-4o', 2],
      ['claude', 1],
    ]);

    const result = aggregateByWeightedAverage(verdicts, weights);
    expect(result).toBeCloseTo(0.8, 5);
  });

  it('falls back to weight 1 for unknown models', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ judgeModel: 'unknown', score: 0.5 }),
      makeVerdict({ judgeModel: 'also-unknown', score: 0.7 }),
    ];
    const result = aggregateByWeightedAverage(verdicts, new Map());
    expect(result).toBeCloseTo(0.6, 5);
  });

  it('returns 0 for empty verdicts', () => {
    expect(aggregateByWeightedAverage([], new Map())).toBe(0);
  });
});

describe('aggregateByMajorityVote', () => {
  it('computes fraction of passing judges at default threshold', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ score: 0.8 }),
      makeVerdict({ score: 0.6 }),
      makeVerdict({ score: 0.3 }),
    ];

    const result = aggregateByMajorityVote(verdicts);
    expect(result).toBeCloseTo(2 / 3, 5);
  });

  it('uses custom threshold', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ score: 0.8 }),
      makeVerdict({ score: 0.6 }),
      makeVerdict({ score: 0.3 }),
    ];

    expect(aggregateByMajorityVote(verdicts, 0.7)).toBeCloseTo(1 / 3, 5);
  });

  it('returns 0 for empty verdicts', () => {
    expect(aggregateByMajorityVote([])).toBe(0);
  });
});

describe('aggregateByMedian', () => {
  it('returns middle value for odd count', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ score: 0.9 }),
      makeVerdict({ score: 0.3 }),
      makeVerdict({ score: 0.7 }),
    ];
    expect(aggregateByMedian(verdicts)).toBe(0.7);
  });

  it('returns average of two middle values for even count', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ score: 0.9 }),
      makeVerdict({ score: 0.3 }),
      makeVerdict({ score: 0.7 }),
      makeVerdict({ score: 0.5 }),
    ];
    expect(aggregateByMedian(verdicts)).toBeCloseTo(0.6, 5);
  });

  it('returns 0 for empty verdicts', () => {
    expect(aggregateByMedian([])).toBe(0);
  });
});

describe('computeAgreement', () => {
  it('returns 1 for unanimous scores in the same bin', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ score: 0.81 }),
      makeVerdict({ score: 0.85 }),
      makeVerdict({ score: 0.82 }),
    ];
    expect(computeAgreement(verdicts)).toBe(1);
  });

  it('returns low agreement for dispersed scores', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ score: 0.1 }),
      makeVerdict({ score: 0.5 }),
      makeVerdict({ score: 0.9 }),
    ];
    expect(computeAgreement(verdicts)).toBeCloseTo(1 / 3, 5);
  });

  it('returns 1 for single judge', () => {
    expect(computeAgreement([makeVerdict({ score: 0.5 })])).toBe(1);
  });

  it('respects custom bin size', () => {
    const verdicts: JudgeVerdict[] = [
      makeVerdict({ score: 0.71 }),
      makeVerdict({ score: 0.79 }),
      makeVerdict({ score: 0.81 }),
    ];
    expect(computeAgreement(verdicts, 0.1)).toBeCloseTo(2 / 3, 5);

    const tight: JudgeVerdict[] = [
      makeVerdict({ score: 0.61 }),
      makeVerdict({ score: 0.65 }),
      makeVerdict({ score: 0.69 }),
    ];
    expect(computeAgreement(tight, 0.2)).toBe(1);
  });
});

describe('runMultiJudgeEvaluation', () => {
  it('runs evaluator for each judge and aggregates', async () => {
    const mockEvaluator = async (model: string) => ({
      score: model === 'gpt-4o' ? 0.9 : model === 'claude' ? 0.7 : 0.5,
      label: 'GOOD' as string | null,
      explanation: `Evaluated by ${model}`,
      latencyMs: 100,
      costUsd: 0.01,
    });

    const config: MultiJudgeConfig = {
      judges: [{ model: 'gpt-4o' }, { model: 'claude' }, { model: 'gemini' }],
      aggregation: 'borda_count',
      blind: true,
      supremeCourtEnabled: false,
    };

    const result = await runMultiJudgeEvaluation(mockEvaluator, config);

    expect(result.verdicts).toHaveLength(3);
    expect(result.aggregationMethod).toBe('borda_count');
    expect(result.blindMode).toBe(true);
    expect(result.metadata.judgeCount).toBe(3);
    expect(result.metadata.supremeJudgeCount).toBe(0);
    expect(result.aggregatedScore).toBeCloseTo(0.5, 5);
    expect(result.aggregatedLabel).toBe('GOOD');
  });

  it('applies supreme court 2x weight', async () => {
    const mockEvaluator = async (model: string) => ({
      score: model === 'supreme' ? 0.9 : 0.5,
      label: null,
      explanation: '',
      latencyMs: 50,
      costUsd: null,
    });

    const config: MultiJudgeConfig = {
      judges: [
        { model: 'supreme', weight: 1, isSupremeJudge: true },
        { model: 'regular', weight: 1 },
      ],
      aggregation: 'weighted_average',
      blind: true,
      supremeCourtEnabled: true,
    };

    const result = await runMultiJudgeEvaluation(mockEvaluator, config);
    expect(result.metadata.supremeJudgeCount).toBe(1);
    expect(result.aggregatedScore).toBeCloseTo((0.9 * 2 + 0.5) / 3, 5);
  });

  it('computes score variance correctly', async () => {
    const mockEvaluator = async (model: string) => ({
      score: model === 'a' ? 1.0 : 0.0,
      label: null,
      explanation: '',
      latencyMs: 10,
      costUsd: null,
    });

    const config: MultiJudgeConfig = {
      judges: [{ model: 'a' }, { model: 'b' }],
      aggregation: 'median',
      blind: true,
      supremeCourtEnabled: false,
    };

    const result = await runMultiJudgeEvaluation(mockEvaluator, config);
    expect(result.metadata.scoreVariance).toBeCloseTo(0.25, 5);
    expect(result.metadata.minScore).toBe(0);
    expect(result.metadata.maxScore).toBe(1);
  });

  it('handles single judge', async () => {
    const mockEvaluator = async () => ({
      score: 0.85,
      label: 'PASS',
      explanation: 'Good',
      latencyMs: 200,
      costUsd: 0.05,
    });

    const config: MultiJudgeConfig = {
      judges: [{ model: 'solo' }],
      aggregation: 'borda_count',
      blind: true,
      supremeCourtEnabled: false,
    };

    const result = await runMultiJudgeEvaluation(mockEvaluator, config);
    expect(result.verdicts).toHaveLength(1);
    expect(result.aggregatedScore).toBe(0.85);
    expect(result.agreement).toBe(1);
    expect(result.metadata.scoreVariance).toBe(0);
  });

  it('handles all same scores', async () => {
    const mockEvaluator = async () => ({
      score: 0.7,
      label: 'OK',
      explanation: 'Fine',
      latencyMs: 100,
      costUsd: null,
    });

    const config: MultiJudgeConfig = {
      judges: [{ model: 'a' }, { model: 'b' }, { model: 'c' }],
      aggregation: 'median',
      blind: true,
      supremeCourtEnabled: false,
    };

    const result = await runMultiJudgeEvaluation(mockEvaluator, config);
    expect(result.aggregatedScore).toBe(0.7);
    expect(result.agreement).toBe(1);
    expect(result.metadata.scoreVariance).toBeCloseTo(0, 10);
    expect(result.metadata.minScore).toBe(0.7);
    expect(result.metadata.maxScore).toBe(0.7);
  });
});
