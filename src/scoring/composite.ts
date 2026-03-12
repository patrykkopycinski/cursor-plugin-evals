import type { DimensionScores } from './dimensions.js';

export interface QualityScore {
  dimensions: Record<string, number>;
  composite: number;
  grade: string;
  weights: Record<string, number>;
}

export const DEFAULT_WEIGHTS: Record<string, number> = {
  structure: 0.15,
  correctness: 0.30,
  security: 0.20,
  performance: 0.15,
  agentReadiness: 0.20,
};

function toGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function computeQualityScore(
  dimensions: DimensionScores,
  weights: Record<string, number> = DEFAULT_WEIGHTS,
): QualityScore {
  let composite = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const value = dimensions[key as keyof DimensionScores] ?? 0;
    composite += value * weight;
    totalWeight += weight;
  }

  if (totalWeight > 0) {
    composite = (composite / totalWeight) * 100;
  }

  composite = Math.round(composite * 100) / 100;

  return {
    dimensions: { ...dimensions },
    composite,
    grade: toGrade(composite),
    weights: { ...weights },
  };
}
