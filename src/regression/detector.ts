import type { Fingerprint } from './fingerprint.js';

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface RegressionResult {
  key: string;
  verdict: Verdict;
  baselineMean: number;
  currentMean: number;
  pValue: number;
  delta: number;
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function variance(arr: number[]): number {
  const m = mean(arr);
  return arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1);
}

/**
 * Welch's t-test (two-sample, unequal variance).
 * Returns a two-tailed p-value approximation using the
 * Welch–Satterthwaite degrees of freedom.
 */
export function welchTTest(
  a: number[],
  b: number[],
): { tStat: number; df: number; pValue: number } {
  const n1 = a.length;
  const n2 = b.length;
  const m1 = mean(a);
  const m2 = mean(b);
  const v1 = variance(a);
  const v2 = variance(b);

  const se = Math.sqrt(v1 / n1 + v2 / n2);
  if (se === 0) {
    // Both samples have zero variance — if means differ the effect is infinite
    if (m1 !== m2) {
      return { tStat: m1 > m2 ? Infinity : -Infinity, df: n1 + n2 - 2, pValue: 0 };
    }
    return { tStat: 0, df: n1 + n2 - 2, pValue: 1 };
  }

  const tStat = (m1 - m2) / se;

  // Welch–Satterthwaite degrees of freedom
  const num = (v1 / n1 + v2 / n2) ** 2;
  const denom = (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1);
  const df = denom === 0 ? n1 + n2 - 2 : num / denom;

  const pValue = twoTailedPValue(Math.abs(tStat), df);

  return { tStat, df, pValue };
}

/**
 * Approximate two-tailed p-value from the t-distribution
 * using the regularized incomplete beta function.
 */
function twoTailedPValue(t: number, df: number): number {
  const x = df / (df + t * t);
  return regularizedIncompleteBeta(x, df / 2, 0.5);
}

/**
 * Regularized incomplete beta function I_x(a,b) via continued fraction.
 * Lentz's algorithm for numerical stability.
 */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);

  // Use Lentz's continued fraction
  const MAX_ITER = 200;
  const EPS = 1e-14;
  const TINY = 1e-30;

  let f = 1 + cfTerm(0, x, a, b);
  if (Math.abs(f) < TINY) f = TINY;
  let c = f;
  let d = 1;

  for (let m = 1; m <= MAX_ITER; m++) {
    const term = cfTerm(m, x, a, b);
    d = 1 + term * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + term / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }

  return front / (a * f);
}

function cfTerm(m: number, x: number, a: number, b: number): number {
  if (m === 0) return 0;
  const k = m;
  if (k % 2 === 0) {
    const j = k / 2;
    return (j * (b - j) * x) / ((a + 2 * j - 1) * (a + 2 * j));
  }
  const j = (k - 1) / 2;
  return -((a + j) * (a + b + j) * x) / ((a + 2 * j) * (a + 2 * j + 1));
}

/** Lanczos approximation for ln(Gamma(x)). */
function lnGamma(x: number): number {
  const g = 7;
  const coefs = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }

  x -= 1;
  let sum = coefs[0];
  for (let i = 1; i < g + 2; i++) {
    sum += coefs[i] / (x + i);
  }
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(sum);
}

/**
 * Detect regressions between a baseline and current fingerprint.
 * Uses Welch's t-test with configurable alpha (default 0.05).
 * Returns INCONCLUSIVE when either sample has fewer than 3 observations.
 */
export function detectRegressions(
  baseline: Fingerprint,
  current: Fingerprint,
  alpha: number = 0.05,
): RegressionResult[] {
  const allKeys = new Set([...Object.keys(baseline.scores), ...Object.keys(current.scores)]);
  const results: RegressionResult[] = [];

  for (const key of allKeys) {
    const baseScores = baseline.scores[key] ?? [];
    const currScores = current.scores[key] ?? [];

    if (baseScores.length < 3 || currScores.length < 3) {
      const bm = baseScores.length > 0 ? mean(baseScores) : 0;
      const cm = currScores.length > 0 ? mean(currScores) : 0;
      results.push({
        key,
        verdict: 'INCONCLUSIVE',
        baselineMean: bm,
        currentMean: cm,
        pValue: 1,
        delta: cm - bm,
      });
      continue;
    }

    const { pValue } = welchTTest(baseScores, currScores);
    const bm = mean(baseScores);
    const cm = mean(currScores);
    const delta = cm - bm;

    let verdict: Verdict;
    if (pValue < alpha && delta < 0) {
      verdict = 'FAIL';
    } else {
      verdict = 'PASS';
    }

    results.push({ key, verdict, baselineMean: bm, currentMean: cm, pValue, delta });
  }

  return results.sort((a, b) => a.key.localeCompare(b.key));
}
