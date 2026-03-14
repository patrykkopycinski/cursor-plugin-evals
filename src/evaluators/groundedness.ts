import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge } from './llm-judge.js';
import { resolveGroundednessConfig } from './config-schemas.js';

const SYSTEM_PROMPT = `You are an evaluation judge checking groundedness. Determine if the output's claims are supported by the tool call results provided.

Respond ONLY with valid JSON:
{
  "score": <0.0-1.0>,
  "label": "<GROUNDED|PARTIALLY_GROUNDED|UNGROUNDED>",
  "explanation": "<list any unsupported claims>"
}

Scoring:
- GROUNDED (0.9-1.0): All claims supported by tool results
- PARTIALLY_GROUNDED (0.5-0.89): Some claims unsupported
- UNGROUNDED (0.0-0.49): Most claims unsupported or hallucinated`;

export class GroundednessEvaluator implements Evaluator {
  name = 'groundedness';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    if (context.adapterCapabilities && !context.adapterCapabilities.hasToolCalls) {
      return {
        evaluator: this.name,
        score: 0,
        pass: true,
        skipped: true,
        label: 'not_applicable',
        explanation: `Adapter "${context.adapterName}" does not support tool calls — groundedness check skipped`,
      };
    }

    if (context.toolCalls.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        pass: true,
        skipped: true,
        label: 'not_applicable',
        explanation: 'No tool calls present — groundedness check skipped',
      };
    }

    const toolResults = context.toolCalls
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
      `Tool call results:\n${toolResults || '(no tool calls)'}`,
    ].join('\n\n');

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const { threshold: configThreshold } = resolveGroundednessConfig(context.config);
      const threshold = configThreshold ?? 0.7;

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
