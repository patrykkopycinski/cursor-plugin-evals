import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge, handleJudgeError } from './llm-judge.js';

const SYSTEM_PROMPT = `You are an evaluation judge for RAG faithfulness. Check whether the output is faithful to the retrieved context (tool call results) — it should not introduce information beyond what was retrieved.

Respond ONLY with valid JSON:
{
  "score": <0.0-1.0>,
  "label": "<FAITHFUL|PARTIALLY_FAITHFUL|UNFAITHFUL>",
  "explanation": "<list any claims not grounded in context>"
}

- FAITHFUL (0.9-1.0): All information in output comes from tool results
- PARTIALLY_FAITHFUL (0.5-0.89): Some claims go beyond retrieved context
- UNFAITHFUL (0.0-0.49): Significant information fabricated beyond context`;

export class ContextFaithfulnessEvaluator implements Evaluator {
  name = 'context-faithfulness';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const retrievedContext = context.toolCalls
      .map((tc) => {
        const text = tc.result.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!)
          .join('\n');
        return `[${tc.tool}]: ${text.slice(0, 1000)}`;
      })
      .join('\n\n');

    const userPrompt = [
      `Output to evaluate: ${context.finalOutput ?? '(empty)'}`,
      `Retrieved context (tool results):\n${retrievedContext || '(no context)'}`,
    ].join('\n\n');

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const threshold = (context.config?.['context-faithfulness'] as number | undefined) ?? 0.7;

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
