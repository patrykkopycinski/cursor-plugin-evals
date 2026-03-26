import type { RunResult } from '../core/types.js';

export interface CostEfficiencyScore {
  score: number;
  grade: string;
  qualityScore: number;
  costUsd: number;
  costPerQualityPoint: number;
  summary: string;
}

function gradeFromScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function computeCostEfficiency(result: RunResult): CostEfficiencyScore {
  const allTests = result.suites.flatMap(s => s.tests);
  const qualityScores = allTests.flatMap(t =>
    t.evaluatorResults.length > 0
      ? [t.evaluatorResults.reduce((s, e) => s + e.score, 0) / t.evaluatorResults.length]
      : [t.pass ? 1 : 0],
  );
  const qualityScore = qualityScores.length > 0
    ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
    : 0;
  const totalCost = allTests.reduce((s, t) => s + (t.costUsd ?? 0), 0);

  if (qualityScore === 0) {
    return { score: 0, grade: 'F', qualityScore: 0, costUsd: totalCost, costPerQualityPoint: Infinity, summary: 'Quality score is 0 — skill produces no value.' };
  }

  const costPenalty = Math.min(totalCost * 20, 50);
  const rawScore = qualityScore * 100 - costPenalty;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const costPerQualityPoint = qualityScore > 0 ? totalCost / qualityScore : Infinity;

  return {
    score, grade: gradeFromScore(score), qualityScore, costUsd: totalCost, costPerQualityPoint,
    summary: `${score}/100 (${gradeFromScore(score)}) — Quality: ${(qualityScore * 100).toFixed(0)}%, Cost: $${totalCost.toFixed(4)}, $/quality: $${costPerQualityPoint.toFixed(4)}`,
  };
}
