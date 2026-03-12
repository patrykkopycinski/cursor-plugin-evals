import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge } from './llm-judge.js';

const LABEL_FLOORS: Record<string, number> = {
  CORRECT: 0.8,
  PARTIALLY_CORRECT: 0.5,
  NOT_IN_GROUND_TRUTH: 0.5,
  INCORRECT: 0.2,
  WRONG: 0.1,
};

const SYSTEM_PROMPT = `You are an evaluation judge. Score the output for correctness relative to the expected output.

Respond ONLY with valid JSON:
{
  "score": <0.0-1.0>,
  "label": "<CORRECT|PARTIALLY_CORRECT|NOT_IN_GROUND_TRUTH|INCORRECT|WRONG>",
  "explanation": "<brief reasoning>"
}

Scoring guidelines:
- CORRECT (0.8-1.0): Output correctly addresses the prompt and matches expected output
- PARTIALLY_CORRECT (0.5-0.79): Output is partially correct but missing key elements
- NOT_IN_GROUND_TRUTH (0.5-0.7): Output is correct but addresses aspects not in expected output
- INCORRECT (0.1-0.49): Output is wrong or misleading
- WRONG (0.0-0.1): Output is completely wrong or harmful`;

export class CorrectnessEvaluator implements Evaluator {
  name = 'correctness';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const expected =
      context.expected?.responseContains?.join(', ') ?? JSON.stringify(context.expected ?? {});

    const userPrompt = [
      `Prompt: ${context.prompt ?? '(none)'}`,
      `Expected: ${expected}`,
      `Actual output: ${context.finalOutput ?? '(empty)'}`,
      context.toolCalls.length > 0
        ? `Tools called: ${context.toolCalls.map((t) => t.tool).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const floor = LABEL_FLOORS[result.label] ?? 0;
      const score = Math.max(result.score, floor);
      const threshold = (context.config?.['correctness'] as number | undefined) ?? 0.7;

      return {
        evaluator: this.name,
        score,
        pass: score >= threshold,
        label: result.label,
        explanation: result.explanation,
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
