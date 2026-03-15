import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge, handleJudgeError } from './llm-judge.js';

const SYSTEM_PROMPT = `You are an evaluation judge. Compare the semantic similarity between the actual output and expected output.

Respond ONLY with valid JSON:
{
  "score": <0.0-1.0>,
  "label": "<EQUIVALENT|SIMILAR|DIFFERENT|UNRELATED>",
  "explanation": "<brief reasoning>"
}

- EQUIVALENT (0.9-1.0): Same meaning, possibly different wording
- SIMILAR (0.6-0.89): Related content with some differences
- DIFFERENT (0.3-0.59): Significantly different content
- UNRELATED (0.0-0.29): Completely unrelated`;

export class SimilarityEvaluator implements Evaluator {
  name = 'similarity';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    if (!context.expected?.responseContains?.length) {
      return {
        evaluator: this.name,
        score: 0,
        pass: true,
        skipped: true,
        label: 'no_expected',
        explanation: 'No expected output specified for similarity comparison — skipped.',
      };
    }

    const expected = context.expected.responseContains.join(', ');

    const userPrompt = [
      `Expected output: ${expected}`,
      `Actual output: ${context.finalOutput ?? '(empty)'}`,
    ].join('\n\n');

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const threshold = (context.config?.['similarity'] as number | undefined) ?? 0.7;

      return {
        evaluator: this.name,
        score: result.score,
        pass: result.score >= threshold,
        label: result.label,
        explanation: result.explanation,
      };
    } catch (err) {
      return handleJudgeError(this.name, err);
    }
  }
}
