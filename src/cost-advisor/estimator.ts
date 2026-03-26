import { getPricingCatalog } from '../pricing/index.js';
import { resolveJudgeModel } from '../evaluators/evaluator-models.js';
import type { EvalConfig } from '../core/types.js';

const LLM_EVALUATORS = new Set([
  'correctness', 'groundedness', 'g-eval', 'similarity',
  'context-faithfulness', 'conversation-coherence', 'criteria',
  'plan-quality', 'task-completion', 'security', 'resistance',
  'keywords', 'response-quality', 'content-quality',
]);

const AVG_INPUT_TOKENS = 500;
const AVG_OUTPUT_TOKENS = 200;

export interface CostBreakdown {
  test: string;
  evaluators: string[];
  judgeCalls: number;
  estimatedUsd: number;
}

export interface CostEstimate {
  totalEstimatedUsd: number;
  judgeCallCount: number;
  breakdown: CostBreakdown[];
  modelBreakdown: Record<string, { calls: number; estimatedUsd: number }>;
}

function findPricing(
  catalog: Record<string, { input: number; output: number; cached?: number }>,
  model: string,
): { input: number; output: number } | null {
  if (catalog[model]) return catalog[model];
  const lower = model.toLowerCase();
  for (const [key, pricing] of Object.entries(catalog)) {
    if (lower.includes(key.toLowerCase())) return pricing;
  }
  return null;
}

export function estimateRunCost(config: EvalConfig): CostEstimate {
  const catalog = getPricingCatalog();
  const defaultModel = config.defaults?.judgeModel ?? 'gpt-5.2';
  const repetitions = config.defaults?.repetitions ?? 1;

  const breakdown: CostBreakdown[] = [];
  const modelCounts = new Map<string, number>();
  let totalCalls = 0;
  let totalCost = 0;

  for (const suite of config.suites ?? []) {
    if (suite.layer === 'static' || suite.layer === 'unit') continue;

    for (const test of suite.tests ?? []) {
      const llmTest = test as { evaluators?: string[]; name: string };
      const evaluators = (llmTest.evaluators ?? []).filter((e) => LLM_EVALUATORS.has(e));
      if (evaluators.length === 0) continue;

      const calls = evaluators.length * repetitions;
      let testCost = 0;

      for (const evalName of evaluators) {
        const model = resolveJudgeModel(evalName) ?? defaultModel;
        const pricing = findPricing(catalog, model);
        if (pricing) {
          const callCost =
            (AVG_INPUT_TOKENS / 1_000_000) * pricing.input +
            (AVG_OUTPUT_TOKENS / 1_000_000) * pricing.output;
          testCost += callCost * repetitions;
        }
        modelCounts.set(model, (modelCounts.get(model) ?? 0) + repetitions);
      }

      totalCalls += calls;
      totalCost += testCost;
      breakdown.push({ test: llmTest.name, evaluators, judgeCalls: calls, estimatedUsd: testCost });
    }
  }

  const modelBreakdown: Record<string, { calls: number; estimatedUsd: number }> = {};
  for (const [model, calls] of modelCounts) {
    const pricing = findPricing(catalog, model);
    const cost = pricing
      ? calls * ((AVG_INPUT_TOKENS / 1_000_000) * pricing.input + (AVG_OUTPUT_TOKENS / 1_000_000) * pricing.output)
      : 0;
    modelBreakdown[model] = { calls, estimatedUsd: cost };
  }

  return { totalEstimatedUsd: totalCost, judgeCallCount: totalCalls, breakdown, modelBreakdown };
}
