import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';

/**
 * Computes the length of the longest common subsequence between two arrays.
 * Uses a standard DP approach in O(m*n) time and O(min(m,n)) space.
 */
export function lcsLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let prev = new Array<number>(short.length + 1).fill(0);
  let curr = new Array<number>(short.length + 1).fill(0);

  for (let i = 1; i <= long.length; i++) {
    for (let j = 1; j <= short.length; j++) {
      if (long[i - 1] === short[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return prev[short.length];
}

export class PathEfficiencyEvaluator implements Evaluator {
  readonly name = 'path-efficiency';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const threshold = (context.config?.['threshold'] as number | undefined) ?? 0.7;
    const coverageWeight = (context.config?.['coverageWeight'] as number | undefined) ?? 0.6;
    const efficiencyWeight = (context.config?.['efficiencyWeight'] as number | undefined) ?? 0.4;

    const goldenPath = context.expected?.goldenPath;

    if (!goldenPath || goldenPath.length === 0) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'skip',
        explanation: 'No golden path specified; skipping evaluation.',
      };
    }

    const actual = context.toolCalls.map((tc) => tc.tool);

    if (actual.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'fail',
        explanation: 'No tool calls made; golden path requires at least one.',
        metadata: {
          coverage: 0,
          efficiency: 0,
          goldenPath,
          actualPath: actual,
          threshold,
        },
      };
    }

    const lcs = lcsLength(actual, goldenPath);
    const coverage = Math.round((lcs / goldenPath.length) * 1000) / 1000;
    const efficiency = Math.round((goldenPath.length / Math.max(actual.length, 1)) * 1000) / 1000;
    const composite =
      Math.round((coverageWeight * coverage + efficiencyWeight * efficiency) * 1000) / 1000;

    return {
      evaluator: this.name,
      score: composite,
      pass: composite >= threshold,
      label: composite >= threshold ? 'pass' : 'fail',
      explanation:
        `Coverage=${coverage.toFixed(3)} (LCS ${lcs}/${goldenPath.length}), ` +
        `Efficiency=${efficiency.toFixed(3)} (${goldenPath.length}/${actual.length}), ` +
        `Composite=${composite.toFixed(3)}. ` +
        `Golden: [${goldenPath.join(' → ')}]. ` +
        `Actual: [${actual.join(' → ')}].`,
      metadata: {
        lcsLength: lcs,
        coverage,
        efficiency,
        coverageWeight,
        efficiencyWeight,
        goldenPath,
        actualPath: actual,
        threshold,
      },
    };
  }
}
