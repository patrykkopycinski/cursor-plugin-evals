import type { TestResult, ToolCallRecord } from '../core/types.js';

export interface PerToolMetrics {
  tool: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface McpRadarReport {
  // Per-tool breakdown
  perToolMetrics: PerToolMetrics[];
  // Aggregate
  toolHitRate: number;           // correct tool AND correct args
  meanReciprocalRank: number;    // MRR for tool selection ordering
  // Resource efficiency
  tokenWasteRatio: number;       // (total tokens - min needed) / total tokens
  avgTokensPerToolCall: number;
  // Execution speed
  avgTimeToFirstToolMs: number;  // planning latency
  avgToolExecutionMs: number;    // per-tool average
  totalExecutionMs: number;
}

function computePerToolMetrics(tests: TestResult[]): PerToolMetrics[] {
  const toolStats = new Map<string, { tp: number; fp: number; fn: number }>();

  for (const test of tests) {
    const expected = new Set(test.evaluatorResults.find(e => e.evaluator === 'tool-selection')?.metadata?.expected as string[] ?? []);
    const actual = new Set(test.toolCalls.map(tc => tc.tool));

    // If no tool-selection evaluator, try to extract from expected field
    const allTools = new Set([...expected, ...actual]);

    for (const tool of allTools) {
      if (!toolStats.has(tool)) toolStats.set(tool, { tp: 0, fp: 0, fn: 0 });
      const stats = toolStats.get(tool)!;

      const inExpected = expected.has(tool);
      const inActual = actual.has(tool);

      if (inExpected && inActual) stats.tp++;
      else if (!inExpected && inActual) stats.fp++;
      else if (inExpected && !inActual) stats.fn++;
    }
  }

  return Array.from(toolStats.entries()).map(([tool, stats]) => {
    const precision = stats.tp + stats.fp > 0 ? stats.tp / (stats.tp + stats.fp) : 0;
    const recall = stats.tp + stats.fn > 0 ? stats.tp / (stats.tp + stats.fn) : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    return { tool, truePositives: stats.tp, falsePositives: stats.fp, falseNegatives: stats.fn, precision, recall, f1 };
  }).sort((a, b) => b.f1 - a.f1);
}

function computeMRR(tests: TestResult[]): number {
  let totalRR = 0;
  let count = 0;

  for (const test of tests) {
    const expected = test.evaluatorResults.find(e => e.evaluator === 'tool-selection')?.metadata?.expected as string[] | undefined;
    if (!expected || expected.length === 0) continue;

    const firstExpected = expected[0];
    const actualOrder = test.toolCalls.map(tc => tc.tool);
    const rank = actualOrder.indexOf(firstExpected);

    if (rank >= 0) totalRR += 1 / (rank + 1);
    count++;
  }

  return count > 0 ? totalRR / count : 0;
}

function computeTokenWaste(tests: TestResult[]): { ratio: number; avgPerToolCall: number } {
  let totalTokens = 0;
  let totalToolCalls = 0;

  for (const test of tests) {
    const input = test.tokenUsage?.input ?? 0;
    const output = test.tokenUsage?.output ?? 0;
    totalTokens += input + output;
    totalToolCalls += test.toolCalls.length;
  }

  const avgPerToolCall = totalToolCalls > 0 ? totalTokens / totalToolCalls : 0;
  // Waste ratio: tokens beyond a baseline of 500 per tool call are considered "waste"
  const baseline = totalToolCalls * 500;
  const waste = totalTokens > baseline ? (totalTokens - baseline) / totalTokens : 0;

  return { ratio: Math.min(1, waste), avgPerToolCall };
}

function computeExecutionSpeed(tests: TestResult[]): { avgTimeToFirstToolMs: number; avgToolExecutionMs: number; totalMs: number } {
  let totalFirstToolTime = 0;
  let totalToolTime = 0;
  let toolCallCount = 0;
  let testsWithTools = 0;

  for (const test of tests) {
    if (test.toolCalls.length > 0) {
      // Planning latency = first tool's latency (proxy for time-to-first-tool)
      totalFirstToolTime += test.toolCalls[0].latencyMs;
      testsWithTools++;
    }
    for (const tc of test.toolCalls) {
      totalToolTime += tc.latencyMs;
      toolCallCount++;
    }
  }

  return {
    avgTimeToFirstToolMs: testsWithTools > 0 ? totalFirstToolTime / testsWithTools : 0,
    avgToolExecutionMs: toolCallCount > 0 ? totalToolTime / toolCallCount : 0,
    totalMs: tests.reduce((s, t) => s + t.latencyMs, 0),
  };
}

export function computeMcpRadarReport(tests: TestResult[]): McpRadarReport {
  const perToolMetrics = computePerToolMetrics(tests);
  const mrr = computeMRR(tests);

  // Tool hit rate: tests where both tool-selection AND tool-args pass
  const testsWithToolEvals = tests.filter(t => t.evaluatorResults.some(e => e.evaluator === 'tool-selection'));
  const hitCount = testsWithToolEvals.filter(t => {
    const selPass = t.evaluatorResults.find(e => e.evaluator === 'tool-selection')?.pass ?? false;
    const argsPass = t.evaluatorResults.find(e => e.evaluator === 'tool-args')?.pass ?? true; // default pass if no args eval
    return selPass && argsPass;
  }).length;
  const toolHitRate = testsWithToolEvals.length > 0 ? hitCount / testsWithToolEvals.length : 0;

  const tokenMetrics = computeTokenWaste(tests);
  const speedMetrics = computeExecutionSpeed(tests);

  return {
    perToolMetrics,
    toolHitRate,
    meanReciprocalRank: mrr,
    tokenWasteRatio: tokenMetrics.ratio,
    avgTokensPerToolCall: tokenMetrics.avgPerToolCall,
    avgTimeToFirstToolMs: speedMetrics.avgTimeToFirstToolMs,
    avgToolExecutionMs: speedMetrics.avgToolExecutionMs,
    totalExecutionMs: speedMetrics.totalMs,
  };
}
