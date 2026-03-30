import type { EvaluatorContext } from '../core/types.js';

export interface EvalCondition {
  /** Only run when tool calls are present */
  hasToolCalls?: boolean;
  /** Only run when specific tools were called */
  toolsInclude?: string[];
  /** Only run when adapter matches */
  adapter?: string | string[];
  /** Only run when output contains pattern */
  outputContains?: string;
  /** Only run when output matches regex */
  outputMatches?: string;
  /** Minimum number of tool calls */
  minToolCalls?: number;
  /** Maximum number of tool calls */
  maxToolCalls?: number;
}

/**
 * Check if an evaluator should run based on the condition and context.
 * Returns true if the evaluator should run, false if it should be skipped.
 * If no condition is specified, always returns true.
 */
export function shouldRunEvaluator(
  condition: EvalCondition | undefined,
  context: EvaluatorContext,
): boolean {
  if (condition == null) return true;

  if (condition.hasToolCalls !== undefined) {
    const hasCalls = context.toolCalls.length > 0;
    if (condition.hasToolCalls !== hasCalls) return false;
  }

  if (condition.toolsInclude !== undefined) {
    const toolSet = new Set(context.toolCalls.map((tc) => tc.tool));
    const hasAll = condition.toolsInclude.some((t) => toolSet.has(t));
    if (!hasAll) return false;
  }

  if (condition.adapter !== undefined) {
    const adapters = Array.isArray(condition.adapter)
      ? condition.adapter
      : [condition.adapter];
    if (!adapters.includes(context.adapterName ?? '')) return false;
  }

  if (condition.outputContains !== undefined) {
    if (!context.finalOutput?.includes(condition.outputContains)) return false;
  }

  if (condition.outputMatches !== undefined) {
    const regex = new RegExp(condition.outputMatches);
    if (!regex.test(context.finalOutput ?? '')) return false;
  }

  if (condition.minToolCalls !== undefined) {
    if (context.toolCalls.length < condition.minToolCalls) return false;
  }

  if (condition.maxToolCalls !== undefined) {
    if (context.toolCalls.length > condition.maxToolCalls) return false;
  }

  return true;
}
