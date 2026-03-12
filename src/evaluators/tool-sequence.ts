import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';

/**
 * Computes the length of the longest common subsequence between two arrays.
 * Uses a standard DP approach in O(m*n) time and O(min(m,n)) space.
 */
function lcsLength(a: string[], b: string[]): number {
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

export class ToolSequenceEvaluator implements Evaluator {
  readonly name = 'tool-sequence';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const threshold =
      (context.config?.['threshold'] as number | undefined) ?? 0.8;
    const expectedSequence = context.expected?.toolSequence;

    if (!expectedSequence || expectedSequence.length === 0) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'skip',
        explanation: 'No expected tool sequence specified; skipping evaluation.',
      };
    }

    const actualSequence = context.toolCalls.map((tc) => tc.tool);
    const lcs = lcsLength(expectedSequence, actualSequence);
    const score =
      Math.round((lcs / expectedSequence.length) * 1000) / 1000;

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= threshold ? 'pass' : 'fail',
      explanation:
        `LCS length=${lcs}/${expectedSequence.length} (score=${score.toFixed(3)}). ` +
        `Expected: [${expectedSequence.join(' → ')}]. ` +
        `Actual: [${actualSequence.join(' → ')}].`,
      metadata: {
        lcsLength: lcs,
        expectedLength: expectedSequence.length,
        actualLength: actualSequence.length,
        expectedSequence,
        actualSequence,
        threshold,
      },
    };
  }
}
