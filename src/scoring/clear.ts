import type { RunResult } from '../core/types.js';

export interface ClearDimension {
  score: number;        // 0-1
  grade: string;        // A-F
  metrics: Record<string, number>;
}

export interface ClearReport {
  cost: ClearDimension;
  latency: ClearDimension;
  efficacy: ClearDimension;
  assurance: ClearDimension;
  reliability: ClearDimension;
  composite: number;    // 0-100
  grade: string;
  paretoEfficient: boolean; // true if cost-normalized accuracy is above median
}

function gradeFromScore(s: number): string {
  if (s >= 0.9) return 'A'; if (s >= 0.8) return 'B'; if (s >= 0.7) return 'C'; if (s >= 0.6) return 'D'; return 'F';
}

function computeCost(result: RunResult): ClearDimension {
  const tests = result.suites.flatMap(s => s.tests);
  const totalCost = tests.reduce((s, t) => s + (t.costUsd ?? 0), 0);
  const avgQuality = result.overall.passRate;

  // Cost-normalized accuracy: quality per dollar (higher is better, capped at 1)
  const cna = totalCost > 0 ? Math.min(1, avgQuality / (totalCost * 10)) : avgQuality > 0 ? 1 : 0;
  // Cost efficiency: penalize high cost
  const costScore = totalCost <= 0.01 ? 1 : totalCost <= 0.1 ? 0.8 : totalCost <= 0.5 ? 0.6 : totalCost <= 1 ? 0.4 : 0.2;

  const score = (cna + costScore) / 2;
  return { score, grade: gradeFromScore(score), metrics: { totalCostUsd: totalCost, costNormalizedAccuracy: cna, costEfficiency: costScore } };
}

function computeLatency(result: RunResult, slaThresholdMs = 5000): ClearDimension {
  const tests = result.suites.flatMap(s => s.tests);
  if (tests.length === 0) return { score: 1, grade: 'A', metrics: { avgLatencyMs: 0, slaComplianceRate: 1, p95Ms: 0 } };

  const latencies = tests.map(t => t.latencyMs).sort((a, b) => a - b);
  const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Ms = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const slaCompliant = tests.filter(t => t.latencyMs <= slaThresholdMs).length;
  const slaComplianceRate = slaCompliant / tests.length;

  const latencyScore = avgLatencyMs <= 1000 ? 1 : avgLatencyMs <= 3000 ? 0.8 : avgLatencyMs <= 5000 ? 0.6 : avgLatencyMs <= 10000 ? 0.4 : 0.2;
  const score = (latencyScore + slaComplianceRate) / 2;

  return { score, grade: gradeFromScore(score), metrics: { avgLatencyMs, slaComplianceRate, p95Ms } };
}

function computeEfficacy(result: RunResult): ClearDimension {
  const tests = result.suites.flatMap(s => s.tests);
  if (tests.length === 0) return { score: 0, grade: 'F', metrics: { passRate: 0, avgEvaluatorScore: 0, taskCompletionRate: 0 } };

  const passRate = result.overall.passRate;
  const allScores = tests.flatMap(t => t.evaluatorResults.map(e => e.score));
  const avgEvaluatorScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : passRate;
  const taskCompletionRate = tests.filter(t => t.pass).length / tests.length;

  const score = (passRate + avgEvaluatorScore + taskCompletionRate) / 3;
  return { score, grade: gradeFromScore(score), metrics: { passRate, avgEvaluatorScore, taskCompletionRate } };
}

function computeAssurance(result: RunResult): ClearDimension {
  const tests = result.suites.flatMap(s => s.tests);
  // Security evaluator scores
  const securityResults = tests.flatMap(t => t.evaluatorResults.filter(e => e.evaluator === 'security' || e.evaluator === 'tool-poisoning' || e.evaluator === 'resistance'));
  const securityScore = securityResults.length > 0 ? securityResults.reduce((s, e) => s + e.score, 0) / securityResults.length : 1;

  // Graceful failure rate: tests that failed but didn't error (clean failure)
  const failedTests = tests.filter(t => !t.pass);
  const errorTests = tests.filter(t => t.error);
  const gracefulFailureRate = failedTests.length > 0 ? (failedTests.length - errorTests.length) / Math.max(failedTests.length, 1) : 1;

  // Hallucination proxy: groundedness evaluator inverse
  const groundednessResults = tests.flatMap(t => t.evaluatorResults.filter(e => e.evaluator === 'groundedness'));
  const groundednessScore = groundednessResults.length > 0 ? groundednessResults.reduce((s, e) => s + e.score, 0) / groundednessResults.length : 0.5;

  const score = (securityScore * 0.4 + gracefulFailureRate * 0.3 + groundednessScore * 0.3);
  return { score, grade: gradeFromScore(score), metrics: { securityScore, gracefulFailureRate, groundednessScore } };
}

function computeReliability(result: RunResult): ClearDimension {
  const tests = result.suites.flatMap(s => s.tests);
  const passRate = result.overall.passRate;

  // Consistency from trial metrics if available
  const perTrialRate = result.trialMetrics?.perTrialSuccessRate ?? passRate;

  // Score variance across tests
  const testScores = tests.map(t => t.evaluatorResults.length > 0 ? t.evaluatorResults.reduce((s, e) => s + e.score, 0) / t.evaluatorResults.length : (t.pass ? 1 : 0));
  const mean = testScores.length > 0 ? testScores.reduce((a, b) => a + b, 0) / testScores.length : 0;
  const variance = testScores.length > 1 ? testScores.reduce((s, v) => s + (v - mean) ** 2, 0) / (testScores.length - 1) : 0;
  const consistencyScore = Math.max(0, 1 - Math.sqrt(variance)); // lower variance = higher consistency

  // pass^k at k=3 if available
  const passHat3 = result.trialMetrics?.passHatK[3] ?? (perTrialRate ** 3);

  const score = (consistencyScore * 0.4 + perTrialRate * 0.3 + Math.min(1, passHat3 + 0.2) * 0.3);
  return { score, grade: gradeFromScore(score), metrics: { consistencyScore, perTrialSuccessRate: perTrialRate, passHat3, scoreVariance: variance } };
}

export function computeClearReport(result: RunResult, options?: { slaThresholdMs?: number }): ClearReport {
  const cost = computeCost(result);
  const latency = computeLatency(result, options?.slaThresholdMs);
  const efficacy = computeEfficacy(result);
  const assurance = computeAssurance(result);
  const reliability = computeReliability(result);

  const composite = Math.round((cost.score + latency.score + efficacy.score + assurance.score + reliability.score) / 5 * 100);
  const paretoEfficient = cost.metrics.costNormalizedAccuracy >= 0.5;

  return { cost, latency, efficacy, assurance, reliability, composite, grade: gradeFromScore(composite / 100), paretoEfficient };
}
