import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge } from './llm-judge.js';

const DEFAULT_CRITERIA = ['relevance', 'coherence'];

export class GEvalEvaluator implements Evaluator {
  name = 'g-eval';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const criteria =
      (context.config?.['g-eval-criteria'] as string[] | undefined) ?? DEFAULT_CRITERIA;

    const systemPrompt = `You are an evaluation judge. Score the output on these criteria: ${criteria.join(', ')}.

For each criterion, assign a score from 1-5, then compute an overall score.

Respond ONLY with valid JSON:
{
  "score": <0.0-1.0 normalized overall>,
  "label": "<EXCELLENT|GOOD|FAIR|POOR>",
  "explanation": "<brief per-criterion assessment>"
}`;

    const userPrompt = [
      `Prompt: ${context.prompt ?? '(none)'}`,
      `Output: ${context.finalOutput ?? '(empty)'}`,
    ].join('\n\n');

    try {
      const result = await callJudge({ systemPrompt, userPrompt });
      const threshold = (context.config?.['g-eval'] as number | undefined) ?? 0.6;

      return {
        evaluator: this.name,
        score: result.score,
        pass: result.score >= threshold,
        label: result.label,
        explanation: result.explanation,
        metadata: { criteria },
      };
    } catch (err) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Judge call failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
