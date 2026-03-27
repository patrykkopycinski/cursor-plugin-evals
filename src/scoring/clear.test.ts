import { describe, it, expect } from 'vitest';
import { computeClearReport, type ClearReport } from './clear.js';
import type { RunResult } from '../core/types.js';

function makeRun(passRate: number, opts?: { costUsd?: number; latencyMs?: number; hasSecurityEval?: boolean }): RunResult {
  const cost = opts?.costUsd ?? 0.01;
  const latency = opts?.latencyMs ?? 500;
  const evals = [{ evaluator: 'correctness', score: passRate, pass: passRate >= 0.5 }];
  if (opts?.hasSecurityEval) evals.push({ evaluator: 'security', score: 1.0, pass: true });

  return {
    runId: 'test', timestamp: '', config: '',
    suites: [{ name: 's', layer: 'llm', tests: [
      { name: 't1', suite: 's', layer: 'llm', pass: passRate >= 0.5, toolCalls: [], evaluatorResults: evals, latencyMs: latency, costUsd: cost },
      { name: 't2', suite: 's', layer: 'llm', pass: passRate >= 0.7, toolCalls: [], evaluatorResults: evals, latencyMs: latency, costUsd: cost },
    ], passRate, duration: latency * 2, evaluatorSummary: {} }],
    overall: { total: 2, passed: passRate >= 0.5 ? (passRate >= 0.7 ? 2 : 1) : 0, failed: passRate >= 0.5 ? (passRate >= 0.7 ? 0 : 1) : 2, skipped: 0, passRate, duration: latency * 2 },
  };
}

describe('computeClearReport', () => {
  it('produces all 5 CLEAR dimensions', () => {
    const report = computeClearReport(makeRun(0.9));
    expect(report.cost).toBeDefined();
    expect(report.latency).toBeDefined();
    expect(report.efficacy).toBeDefined();
    expect(report.assurance).toBeDefined();
    expect(report.reliability).toBeDefined();
    expect(report.composite).toBeGreaterThan(0);
    expect(report.grade).toBeTruthy();
  });

  it('scores high quality + low cost + low latency as A grade', () => {
    const report = computeClearReport(makeRun(0.95, { costUsd: 0.001, latencyMs: 200, hasSecurityEval: true }));
    expect(report.composite).toBeGreaterThan(70);
  });

  it('penalizes high cost', () => {
    const cheap = computeClearReport(makeRun(0.9, { costUsd: 0.001 }));
    const expensive = computeClearReport(makeRun(0.9, { costUsd: 5.0 }));
    expect(cheap.cost.score).toBeGreaterThan(expensive.cost.score);
  });

  it('penalizes high latency', () => {
    const fast = computeClearReport(makeRun(0.9, { latencyMs: 200 }));
    const slow = computeClearReport(makeRun(0.9, { latencyMs: 15000 }));
    expect(fast.latency.score).toBeGreaterThan(slow.latency.score);
  });

  it('computes SLA compliance rate', () => {
    const report = computeClearReport(makeRun(0.9, { latencyMs: 3000 }), { slaThresholdMs: 5000 });
    expect(report.latency.metrics.slaComplianceRate).toBe(1);
  });

  it('computes cost-normalized accuracy', () => {
    const report = computeClearReport(makeRun(0.9, { costUsd: 0.01 }));
    expect(report.cost.metrics.costNormalizedAccuracy).toBeGreaterThan(0);
  });

  it('includes Pareto efficiency flag', () => {
    const efficient = computeClearReport(makeRun(0.9, { costUsd: 0.001 }));
    expect(typeof efficient.paretoEfficient).toBe('boolean');
  });

  it('handles empty run', () => {
    const empty: RunResult = {
      runId: '', timestamp: '', config: '', suites: [],
      overall: { total: 0, passed: 0, failed: 0, skipped: 0, passRate: 0, duration: 0 },
    };
    const report = computeClearReport(empty);
    expect(report.composite).toBeGreaterThanOrEqual(0);
  });

  it('includes reliability metrics', () => {
    const report = computeClearReport(makeRun(0.8));
    expect(typeof report.reliability.metrics.consistencyScore).toBe('number');
    expect(typeof report.reliability.metrics.scoreVariance).toBe('number');
  });

  it('includes assurance metrics', () => {
    const report = computeClearReport(makeRun(0.8, { hasSecurityEval: true }));
    expect(report.assurance.metrics.securityScore).toBe(1.0);
    expect(typeof report.assurance.metrics.gracefulFailureRate).toBe('number');
  });
});
