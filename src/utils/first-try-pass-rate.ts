/**
 * First-try pass rate computation.
 *
 * Given test results that may include repetitions, computes the fraction
 * of test cases that passed on their very first attempt (repetition === 1
 * or the lowest repetition number).
 */

import type { TestResult, TrialMetrics } from '../core/types.js';

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

/**
 * Compute pass@k and pass^k trial metrics from a set of test results.
 *
 * Groups results by test name, computes the per-trial success rate for each
 * test (fraction of repetitions that passed), averages across tests to get
 * an overall per-trial success rate p, then derives:
 *   - pass@k  = 1 - (1 - p)^k  (probability at least 1 of k trials succeeds)
 *   - pass^k  = p^k             (probability all k trials succeed)
 *
 * kValues defaults to a deduplicated sorted array of [1, numRepetitions, 10].
 */
export function computeTrialMetrics(results: TestResult[], kValues?: number[]): TrialMetrics {
  if (results.length === 0) {
    const ks = kValues ?? [1, 10];
    const sortedKs = [...new Set(ks)].sort((a, b) => a - b);
    const passAtK: Record<number, number> = {};
    const passHatK: Record<number, number> = {};
    for (const k of sortedKs) {
      passAtK[k] = 0;
      passHatK[k] = 0;
    }
    return { perTrialSuccessRate: 0, passAtK, passHatK, kValues: sortedKs };
  }

  // Group by test name
  const byName = new Map<string, TestResult[]>();
  for (const r of results) {
    const existing = byName.get(r.name) ?? [];
    existing.push(r);
    byName.set(r.name, existing);
  }

  // Per-test success rate = fraction of repetitions that passed
  const perTestRates: number[] = [];
  for (const attempts of byName.values()) {
    const passCount = attempts.filter((a) => a.pass).length;
    perTestRates.push(attempts.length > 0 ? passCount / attempts.length : 0);
  }

  // Average across tests
  const p =
    perTestRates.length > 0
      ? perTestRates.reduce((s, r) => s + r, 0) / perTestRates.length
      : 0;

  // Determine kValues: deduplicated, sorted
  const maxReps = Math.max(...results.map((r) => r.repetition ?? 1));
  const rawKValues = kValues ?? [1, maxReps, 10];
  const sortedKs = [...new Set(rawKValues)].sort((a, b) => a - b);

  const passAtK: Record<number, number> = {};
  const passHatK: Record<number, number> = {};
  for (const k of sortedKs) {
    passAtK[k] = 1 - Math.pow(1 - p, k);
    passHatK[k] = Math.pow(p, k);
  }

  return { perTrialSuccessRate: p, passAtK, passHatK, kValues: sortedKs };
}
