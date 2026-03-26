import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge, handleJudgeError } from './llm-judge.js';

const DEFAULT_DESCRIPTION = 'Is the response helpful, accurate, and complete?';

export class NlScorerEvaluator implements Evaluator {
  name = 'nl-scorer';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const description = (context.config?.['nl-scorer'] as string | undefined) ?? DEFAULT_DESCRIPTION;
    const threshold = (context.config?.['nl-scorer-threshold'] as number | undefined) ?? 0.7;

    const systemPrompt = `You are an evaluation judge. Score the output based on this criterion:\n\n"${description}"\n\nRespond ONLY with valid JSON:\n{\n  "score": <0.0-1.0>,\n  "label": "<EXCELLENT|GOOD|FAIR|POOR>",\n  "explanation": "<brief reasoning tied to the criterion>"\n}`;

    const userPrompt = [`Prompt: ${context.prompt ?? '(none)'}`, `Output: ${context.finalOutput ?? '(empty)'}`].join('\n\n');

    try {
      const result = await callJudge({ systemPrompt, userPrompt });
      return {
        evaluator: this.name, score: result.score, pass: result.score >= threshold,
        label: result.label, explanation: result.explanation,
        metadata: { criterion: description, threshold },
      };
    } catch (err) {
      return handleJudgeError(this.name, err);
    }
  }
}
