import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge } from './llm-judge.js';

const SYSTEM_PROMPT = `You are an evaluation judge assessing the quality of an AI agent's reasoning and planning.

Given the user's prompt and the sequence of tool calls the agent made, evaluate:

1. **Goal Decomposition**: Did the agent break the task into appropriate steps?
2. **Step Ordering**: Are the steps in a logical order with proper dependencies?
3. **Tool Appropriateness**: Are the selected tools the best fit for each step?
4. **Efficiency**: Are there redundant, unnecessary, or wasted tool calls?

Respond ONLY with valid JSON:
{
  "score": <0.0-1.0>,
  "label": "<EXCELLENT|GOOD|ADEQUATE|POOR|TERRIBLE>",
  "explanation": "<brief reasoning covering each dimension>"
}

Scoring guidelines:
- EXCELLENT (0.9-1.0): Clear decomposition, optimal ordering, best tools chosen, no waste
- GOOD (0.7-0.89): Reasonable plan with minor suboptimalities
- ADEQUATE (0.5-0.69): Plan achieves the goal but with notable inefficiencies or missteps
- POOR (0.2-0.49): Significant planning failures — wrong tools, bad ordering, or many wasted calls
- TERRIBLE (0.0-0.19): No coherent plan, random or counterproductive actions`;

export class PlanQualityEvaluator implements Evaluator {
  name = 'plan-quality';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const toolSummary = context.toolCalls
      .map((tc, i) => {
        const argsStr = JSON.stringify(tc.args).slice(0, 200);
        const resultSnippet = tc.result.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!.slice(0, 100))
          .join(' ');
        const status = tc.result.isError ? ' [ERROR]' : '';
        return `${i + 1}. ${tc.tool}(${argsStr})${status} → ${resultSnippet || '(empty)'}`;
      })
      .join('\n');

    const userPrompt = [
      `User prompt: ${context.prompt ?? '(none)'}`,
      `Total tool calls: ${context.toolCalls.length}`,
      toolSummary ? `Tool call sequence:\n${toolSummary}` : 'No tool calls were made.',
      context.finalOutput ? `Final output (first 500 chars): ${context.finalOutput.slice(0, 500)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const threshold = (context.config?.['plan-quality'] as number | undefined) ?? 0.6;

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
