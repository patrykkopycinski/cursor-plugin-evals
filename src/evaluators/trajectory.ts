import type { Evaluator, EvaluatorContext, EvaluatorResult, ToolCallRecord } from '../core/types.js';

export interface TrajectoryStep {
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
}

export interface TrajectoryMetrics {
  pathSimilarity: number;
  stepEfficiency: number;
  backtrackPenalty: number;
  redundancyPenalty: number;
  errorRecoveryBonus: number;
  overall: number;
}

export function extractTrajectory(toolCalls: ToolCallRecord[]): TrajectoryStep[] {
  return toolCalls.map(tc => ({
    tool: tc.tool,
    args: tc.args,
    success: !tc.result.isError,
  }));
}

export function computeLCS(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

export function scoreTrajectory(
  actual: TrajectoryStep[],
  goldenPath?: string[],
  expectedTools?: string[],
): TrajectoryMetrics {
  const actualTools = actual.map(s => s.tool);

  let pathSimilarity = 1;
  if (goldenPath && goldenPath.length > 0) {
    const lcs = computeLCS(actualTools, goldenPath);
    pathSimilarity = lcs / goldenPath.length;
  } else if (expectedTools && expectedTools.length > 0) {
    const covered = expectedTools.filter(t => actualTools.includes(t)).length;
    pathSimilarity = covered / expectedTools.length;
  }

  const idealLength = goldenPath?.length ?? expectedTools?.length ?? actual.length;
  const stepEfficiency = idealLength > 0 ? Math.min(1, idealLength / Math.max(actual.length, 1)) : 1;

  let backtracks = 0;
  const seen = new Set<string>();
  for (const step of actual) {
    if (seen.has(step.tool) && !step.success) backtracks++;
    seen.add(step.tool);
  }
  const backtrackPenalty = actual.length > 0 ? backtracks / actual.length : 0;

  const toolCounts = new Map<string, number>();
  for (const t of actualTools) toolCounts.set(t, (toolCounts.get(t) ?? 0) + 1);
  const redundantCalls = [...toolCounts.values()].reduce((sum, c) => sum + Math.max(0, c - 1), 0);
  const redundancyPenalty = actual.length > 0 ? redundantCalls / actual.length : 0;

  let errorRecoveryBonus = 0;
  for (let i = 0; i < actual.length - 1; i++) {
    if (!actual[i].success && actual[i + 1].success) errorRecoveryBonus += 0.1;
  }
  errorRecoveryBonus = Math.min(errorRecoveryBonus, 0.3);

  const overall = Math.max(0, Math.min(1,
    pathSimilarity * 0.35 +
    stepEfficiency * 0.25 +
    (1 - backtrackPenalty) * 0.15 +
    (1 - redundancyPenalty) * 0.1 +
    errorRecoveryBonus * 0.15
  ));

  return { pathSimilarity, stepEfficiency, backtrackPenalty, redundancyPenalty, errorRecoveryBonus, overall };
}

export class TrajectoryEvaluator implements Evaluator {
  readonly name = 'trajectory';
  readonly kind = 'CODE' as const;

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const trajectory = extractTrajectory(context.toolCalls);
    const metrics = scoreTrajectory(
      trajectory,
      context.expected?.goldenPath,
      context.expected?.tools,
    );

    const threshold = (context.config?.trajectoryThreshold as number) ?? 0.6;

    return {
      evaluator: this.name,
      score: metrics.overall,
      pass: metrics.overall >= threshold,
      label: metrics.overall >= 0.9 ? 'excellent' : metrics.overall >= 0.7 ? 'good' : metrics.overall >= 0.5 ? 'fair' : 'poor',
      explanation: `Path similarity: ${(metrics.pathSimilarity * 100).toFixed(0)}%, Efficiency: ${(metrics.stepEfficiency * 100).toFixed(0)}%, Backtracks: ${(metrics.backtrackPenalty * 100).toFixed(0)}%, Redundancy: ${(metrics.redundancyPenalty * 100).toFixed(0)}%`,
      metadata: metrics as unknown as Record<string, unknown>,
    };
  }
}
