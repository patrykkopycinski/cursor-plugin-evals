/**
 * First-try pass rate computation.
 *
 * Given test results that may include repetitions, computes the fraction
 * of test cases that passed on their very first attempt (repetition === 1
 * or the lowest repetition number).
 */

import type { TestResult } from '../core/types.js';

export interface FirstTryStats {
  firstTryPassRate: number;
  firstTryPassed: number;
  firstTryTotal: number;
  testBreakdown: Array<{
    name: string;
    passedFirstTry: boolean;
    firstTryScore: number;
  }>;
}

/**
 * Compute the first-try pass rate from a set of test results.
 *
 * Groups results by test name, finds the attempt with the lowest repetition
 * number (defaulting to 1), and checks whether that attempt passed.
 */
export function computeFirstTryPassRate(results: TestResult[]): FirstTryStats {
  const byName = new Map<string, TestResult[]>();

  for (const r of results) {
    const existing = byName.get(r.name) ?? [];
    existing.push(r);
    byName.set(r.name, existing);
  }

  const breakdown: FirstTryStats['testBreakdown'] = [];

  for (const [name, attempts] of byName) {
    const sorted = [...attempts].sort((a, b) => (a.repetition ?? 1) - (b.repetition ?? 1));
    const firstAttempt = sorted[0];

    const avgScore =
      firstAttempt.evaluatorResults.length > 0
        ? firstAttempt.evaluatorResults.reduce((s, er) => s + er.score, 0) /
          firstAttempt.evaluatorResults.length
        : firstAttempt.pass
          ? 1.0
          : 0.0;

    breakdown.push({
      name,
      passedFirstTry: firstAttempt.pass,
      firstTryScore: avgScore,
    });
  }

  const passed = breakdown.filter((b) => b.passedFirstTry).length;
  const total = breakdown.length;

  return {
    firstTryPassRate: total > 0 ? passed / total : 0,
    firstTryPassed: passed,
    firstTryTotal: total,
    testBreakdown: breakdown,
  };
}
