import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge } from './llm-judge.js';

const SYSTEM_PROMPT = `You are an evaluation judge assessing whether an AI agent achieved the user's goal.

Given the original user prompt, the full sequence of tool calls with their results, and the agent's final output, determine whether the user's actual goal was accomplished.

Respond ONLY with valid JSON:
{
  "score": <0.0 | 0.5 | 1.0>,
  "label": "<FULLY_ACHIEVED|PARTIALLY_ACHIEVED|NOT_ACHIEVED>",
  "explanation": "<brief reasoning>"
}

Scoring guidelines:
- FULLY_ACHIEVED (1.0): The user's goal was completely and correctly accomplished
- PARTIALLY_ACHIEVED (0.5): Some aspects of the goal were met but significant parts are missing or incorrect
- NOT_ACHIEVED (0.0): The goal was not accomplished at all, or the result is fundamentally wrong`;

export class TaskCompletionEvaluator implements Evaluator {
  name = 'task-completion';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const toolSummary = context.toolCalls
      .map((tc, i) => {
        const argsStr = JSON.stringify(tc.args).slice(0, 200);
        const resultText = tc.result.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!.slice(0, 150))
          .join(' ');
        const status = tc.result.isError ? ' [ERROR]' : '';
        return `${i + 1}. ${tc.tool}(${argsStr})${status} → ${resultText || '(empty)'}`;
      })
      .join('\n');

    const expected = context.expected
      ? `Expected output hints: ${JSON.stringify(context.expected)}`
      : '';

    const userPrompt = [
      `Original user prompt: ${context.prompt ?? '(none)'}`,
      expected,
      toolSummary ? `Tool calls and results:\n${toolSummary}` : 'No tool calls were made.',
      `Final output: ${context.finalOutput ?? '(empty)'}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const threshold = (context.config?.['task-completion'] as number | undefined) ?? 0.5;

      return {
        evaluator: this.name,
        score: result.score,
        pass: result.score >= threshold,
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
