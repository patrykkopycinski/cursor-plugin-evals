import { randomUUID } from 'node:crypto';
import type { RunResult, TestResult } from '../core/types.js';

export function mergeReports(reports: RunResult[]): RunResult {
  if (reports.length === 0) {
    return {
      runId: randomUUID(),
      timestamp: new Date().toISOString(),
      config: '',
      suites: [],
      overall: { total: 0, passed: 0, failed: 0, skipped: 0, passRate: 1, duration: 0 },
    };
  }

  const allSuites = reports.flatMap((r) => r.suites);
  const allTests: TestResult[] = allSuites.flatMap((s) => s.tests);

  const total = allTests.length;
  const passed = allTests.filter((t) => t.pass).length;
  const failed = total - passed;
  const skipped = allTests.filter((t) => t.skipped).length;
  const duration = reports.reduce((sum, r) => sum + r.overall.duration, 0);

  const merged: RunResult = {
    runId: randomUUID(),
    timestamp: new Date().toISOString(),
    config: reports[0].config,
    suites: allSuites,
    overall: {
      total,
      passed,
      failed,
      skipped,
      passRate: total > 0 ? passed / total : 1,
      duration,
    },
  };

  const qualityScores = reports.filter((r) => r.qualityScore);
  if (qualityScores.length > 0) {
    merged.qualityScore = qualityScores[qualityScores.length - 1].qualityScore;
  }

  const derivedMetrics = reports.flatMap((r) => r.derivedMetrics ?? []);
  if (derivedMetrics.length > 0) {
    merged.derivedMetrics = derivedMetrics;
  }

  return merged;
}
