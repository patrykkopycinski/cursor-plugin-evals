import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { resolveTokenUsageConfig } from './config-schemas.js';

export class TokenUsageEvaluator implements Evaluator {
  name = 'token-usage';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const usage = context.tokenUsage;
    if (!usage) {
      return {
        evaluator: this.name,
        score: 0,
        pass: true,
        skipped: true,
        label: 'no_data',
        explanation: 'No token usage data available — skipped',
      };
    }

    const budget = resolveTokenUsageConfig(context.config);

    let inputTokens = usage.input;
    if (inputTokens === 0 && context.adapterCapabilities && !context.adapterCapabilities.reportsInputTokens) {
      const promptLen = context.prompt?.length ?? 0;
      const toolResultLen = context.toolCalls
        .map((tc) => tc.result.content.map((c) => c.text?.length ?? 0).reduce((a, b) => a + b, 0))
        .reduce((a, b) => a + b, 0);
      inputTokens = Math.ceil((promptLen + toolResultLen) / 4);
    }

    const total = inputTokens + usage.output;
    const violations: string[] = [];
    const details: Record<string, unknown> = {
      input: inputTokens,
      output: usage.output,
      total,
      inputEstimated: inputTokens !== usage.input,
    };

    if (budget.max_input && inputTokens > 0 && inputTokens > budget.max_input) {
      violations.push(`input ${inputTokens} > max ${budget.max_input}`);
      details.maxInput = budget.max_input;
    }
    if (budget.max_output && usage.output > 0 && usage.output > budget.max_output) {
      violations.push(`output ${usage.output} > max ${budget.max_output}`);
      details.maxOutput = budget.max_output;
    }
    if (budget.max_total && total > budget.max_total) {
      violations.push(`total ${total} > max ${budget.max_total}`);
      details.maxTotal = budget.max_total;
    }

    const hasBudget = budget.max_input || budget.max_output || budget.max_total;
    if (!hasBudget) {
      return {
        evaluator: this.name,
        score: 1,
        pass: true,
        label: 'report_only',
        explanation: `Tokens: ${inputTokens} in / ${usage.output} out / ${total} total. No budget set — reporting only.`,
        metadata: details,
      };
    }

    if (violations.length === 0) {
      const ratios: number[] = [];
      if (budget.max_input && inputTokens > 0) ratios.push(inputTokens / budget.max_input);
      if (budget.max_output && usage.output > 0) ratios.push(usage.output / budget.max_output);
      if (budget.max_total && total > 0) ratios.push(total / budget.max_total);
      const maxRatio = ratios.length > 0 ? Math.max(...ratios) : 0;
      const efficiency = Math.max(0, Math.min(1, 1 - maxRatio * 0.5));

      return {
        evaluator: this.name,
        score: efficiency,
        pass: true,
        label: maxRatio < 0.5 ? 'efficient' : maxRatio < 0.8 ? 'moderate' : 'near_limit',
        explanation:
          `Tokens: ${inputTokens} in / ${usage.output} out / ${total} total. ` +
          `Budget utilization: ${(maxRatio * 100).toFixed(0)}%.`,
        metadata: details,
      };
    }

    const worstRatio = Math.max(
      budget.max_input && inputTokens > 0 ? inputTokens / budget.max_input : 0,
      budget.max_output && usage.output > 0 ? usage.output / budget.max_output : 0,
      budget.max_total && total > 0 ? total / budget.max_total : 0,
    );
    const score = Math.max(0, 2 - worstRatio);

    return {
      evaluator: this.name,
      score,
      pass: false,
      label: 'over_budget',
      explanation: `Token budget exceeded: ${violations.join('; ')}`,
      metadata: details,
    };
  }
}
