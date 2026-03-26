import { welchTTest } from '../regression/detector.js';
import type { RunResult } from '../core/types.js';

export interface VariantResult { variantA: string; variantB: string; meanA: number; meanB: number; delta: number; pValue: number; significant: boolean; winner: string | null; summary: string; }

function extractScores(run: RunResult): number[] {
  return run.suites.flatMap(s => s.tests.map(t => t.evaluatorResults.length > 0 ? t.evaluatorResults.reduce((sum, e) => sum + e.score, 0) / t.evaluatorResults.length : (t.pass ? 1 : 0)));
}

function mean(arr: number[]): number { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }

export function compareSkillVariants(runA: RunResult, runB: RunResult, nameA: string, nameB: string): VariantResult {
  const scoresA = extractScores(runA);
  const scoresB = extractScores(runB);
  const meanA = mean(scoresA);
  const meanB = mean(scoresB);
  const delta = meanB - meanA;
  let pValue = 1;
  if (scoresA.length >= 2 && scoresB.length >= 2) ({ pValue } = welchTTest(scoresA, scoresB));
  const significant = pValue < 0.05;
  const winner = significant ? (delta > 0 ? nameB : nameA) : null;
  const dir = delta > 0 ? 'improved' : delta < 0 ? 'degraded' : 'unchanged';
  const sig = significant ? 'statistically significant' : 'not statistically significant';
  return { variantA: nameA, variantB: nameB, meanA, meanB, delta, pValue, significant, winner, summary: `${nameB} ${dir} by ${(Math.abs(delta) * 100).toFixed(1)}pp vs ${nameA} (p=${pValue.toFixed(4)}, ${sig}). ${winner ? `Winner: ${winner}` : 'No clear winner.'}` };
}
