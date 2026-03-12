import type { ConfidenceInterval } from '../core/types.js';

const Z_SCORES: Record<number, number> = {
  0.90: 1.645,
  0.95: 1.96,
  0.99: 2.576,
};

function getZScore(confidenceLevel: number): number {
  const cached = Z_SCORES[confidenceLevel];
  if (cached !== undefined) return cached;
  return 1.96;
}

export function computeConfidenceInterval(
  scores: number[],
  confidenceLevel: number = 0.95,
): ConfidenceInterval {
  const n = scores.length;

  if (n === 0) {
    return { mean: 0, stddev: 0, lowerBound: 0, upperBound: 0, sampleSize: 0 };
  }

  if (n === 1) {
    return { mean: scores[0], stddev: 0, lowerBound: scores[0], upperBound: scores[0], sampleSize: 1 };
  }

  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / (n - 1);
  const stddev = Math.sqrt(variance);
  const z = getZScore(confidenceLevel);
  const margin = z * (stddev / Math.sqrt(n));

  return {
    mean: Math.round(mean * 10000) / 10000,
    stddev: Math.round(stddev * 10000) / 10000,
    lowerBound: Math.round(Math.max(0, mean - margin) * 10000) / 10000,
    upperBound: Math.round(Math.min(1, mean + margin) * 10000) / 10000,
    sampleSize: n,
  };
}

export interface AggregatedConfidence {
  overall: ConfidenceInterval;
  byEvaluator: Record<string, ConfidenceInterval>;
  byModel: Record<string, ConfidenceInterval>;
}

export interface ScoreEntry {
  score: number;
  evaluator?: string;
  model?: string;
}

export function aggregateConfidence(
  entries: ScoreEntry[],
  confidenceLevel: number = 0.95,
): AggregatedConfidence {
  const allScores = entries.map((e) => e.score);

  const byEvaluator = new Map<string, number[]>();
  const byModel = new Map<string, number[]>();

  for (const entry of entries) {
    if (entry.evaluator) {
      const arr = byEvaluator.get(entry.evaluator);
      if (arr) arr.push(entry.score);
      else byEvaluator.set(entry.evaluator, [entry.score]);
    }
    if (entry.model) {
      const arr = byModel.get(entry.model);
      if (arr) arr.push(entry.score);
      else byModel.set(entry.model, [entry.score]);
    }
  }

  const evalCIs: Record<string, ConfidenceInterval> = {};
  for (const [name, scores] of byEvaluator) {
    evalCIs[name] = computeConfidenceInterval(scores, confidenceLevel);
  }

  const modelCIs: Record<string, ConfidenceInterval> = {};
  for (const [name, scores] of byModel) {
    modelCIs[name] = computeConfidenceInterval(scores, confidenceLevel);
  }

  return {
    overall: computeConfidenceInterval(allScores, confidenceLevel),
    byEvaluator: evalCIs,
    byModel: modelCIs,
  };
}

/**
 * Determines pass/fail using the CI lower bound instead of the mean.
 * More conservative — ensures the score is likely above the threshold
 * even accounting for variance.
 */
export function confidenceGatingPass(
  ci: ConfidenceInterval,
  threshold: number,
): boolean {
  return ci.lowerBound >= threshold;
}
