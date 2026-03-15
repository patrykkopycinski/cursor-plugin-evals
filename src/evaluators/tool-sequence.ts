import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';
import { lcsLength } from './path-efficiency.js';

export class ToolSequenceEvaluator implements Evaluator {
  readonly name = 'tool-sequence';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const threshold = (context.config?.['threshold'] as number | undefined) ?? 0.8;
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
    const score = Math.round((lcs / expectedSequence.length) * 1000) / 1000;

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
