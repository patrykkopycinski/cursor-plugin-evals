import { welchTTest } from '../regression/detector.js';
import type { RunResult } from '../core/types.js';

export interface AblationResult {
  skillHelps: boolean;
  delta: number;
  withSkillMean: number;
  withoutSkillMean: number;
  pValue: number;
  summary: string;
}

function extractScores(run: RunResult): number[] {
  const scores: number[] = [];

  for (const suite of run.suites) {
    for (const test of suite.tests) {
      if (test.evaluatorResults.length > 0) {
        const avg =
          test.evaluatorResults.reduce((sum, r) => sum + r.score, 0) /
          test.evaluatorResults.length;
        scores.push(avg);
      } else {
        scores.push(test.pass ? 1 : 0);
      }
    }
  }

  return scores;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, x) => sum + x, 0) / arr.length;
}

export function computeAblation(withSkill: RunResult, withoutSkill: RunResult): AblationResult {
  const withScores = extractScores(withSkill);
  const withoutScores = extractScores(withoutSkill);

  const withSkillMean = mean(withScores);
  const withoutSkillMean = mean(withoutScores);
  const delta = withSkillMean - withoutSkillMean;

  let pValue: number;
  if (withScores.length >= 2 && withoutScores.length >= 2) {
    ({ pValue } = welchTTest(withScores, withoutScores));
  } else {
    pValue = 1;
  }

  const skillHelps = delta > 0 && pValue < 0.05;

  const direction = delta > 0 ? 'improved' : delta < 0 ? 'degraded' : 'unchanged';
  const absDeltaPct = Math.abs(delta * 100).toFixed(1);
  const significance =
    pValue < 0.05 ? 'statistically significant' : 'not statistically significant';

  const summary =
    `Skill ${direction} scores by ${absDeltaPct} percentage points ` +
    `(p=${pValue.toFixed(4)}, ${significance}). ` +
    `With skill: ${(withSkillMean * 100).toFixed(1)}%, Without: ${(withoutSkillMean * 100).toFixed(1)}%.`;

  return {
    skillHelps,
    delta,
    withSkillMean,
    withoutSkillMean,
    pValue,
    summary,
  };
}
