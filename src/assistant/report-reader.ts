import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunResult, TestResult } from '../core/types.js';
import type { TestResultForClustering } from '../reporting/failure-clustering.js';
import { clusterFailures } from '../reporting/failure-clustering.js';
import type {
  AnalysisReport,
  FailureClusterSummary,
  RegressionSummary,
  CostOptimization,
  ThresholdCheck,
  SuggestedAction,
  CoverageGap,
} from './types.js';

const RESULTS_DIR = '.cursor-plugin-evals';

export async function findLatestRunResult(rootDir: string): Promise<RunResult | null> {
  const resultsDir = join(rootDir, RESULTS_DIR, 'results');
  let files: string[];
  try {
    files = await readdir(resultsDir);
  } catch {
    return null;
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json')).sort().reverse();
  if (jsonFiles.length === 0) return null;

  try {
    const raw = await readFile(join(resultsDir, jsonFiles[0]), 'utf-8');
    return JSON.parse(raw) as RunResult;
  } catch {
    return null;
  }
}

export async function loadRunResult(filePath: string): Promise<RunResult> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as RunResult;
}

function toClusterInput(tests: TestResult[]): TestResultForClustering[] {
  return tests.map((t) => ({
    name: t.name,
    toolsCalled: t.toolCalls.map((tc) => tc.tool),
    expected: t.evaluatorResults.length > 0
      ? { tools: undefined, toolSequence: undefined }
      : undefined,
    evaluators: t.evaluatorResults.map((er) => ({
      name: er.evaluator,
      score: er.score,
      label: er.label ?? null,
    })),
  }));
}

function analyzeFailures(tests: TestResult[]): FailureClusterSummary[] {
  const failed = tests.filter((t) => !t.pass);
  if (failed.length === 0) return [];

  const clusters = clusterFailures(toClusterInput(failed));
  return clusters.map((c) => ({
    category: c.category,
    count: c.count,
    tests: c.testNames,
    remediation: c.recommendedAction,
  }));
}

function detectFlakyTests(tests: TestResult[]): string[] {
  const byName = new Map<string, boolean[]>();
  for (const t of tests) {
    const results = byName.get(t.name) ?? [];
    results.push(t.pass);
    byName.set(t.name, results);
  }

  const flaky: string[] = [];
  for (const [name, results] of byName) {
    if (results.length > 1) {
      const hasPass = results.some((r) => r);
      const hasFail = results.some((r) => !r);
      if (hasPass && hasFail) flaky.push(name);
    }
  }
  return flaky;
}

function checkThresholdAdequacy(result: RunResult): ThresholdCheck[] {
  const checks: ThresholdCheck[] = [];
  const passRate = result.overall.passRate;

  if (passRate === 1.0 && result.overall.total > 5) {
    checks.push({
      metric: 'pass_rate',
      current: passRate,
      threshold: 1.0,
      status: 'too_lenient',
      suggestion: 'All tests pass — consider adding harder tests or raising thresholds',
    });
  }

  if (passRate < 0.3 && result.overall.total > 3) {
    checks.push({
      metric: 'pass_rate',
      current: passRate,
      threshold: 0.8,
      status: 'too_strict',
      suggestion: 'Very low pass rate — review if tests and thresholds are realistic',
    });
  }

  return checks;
}

function buildSuggestedActions(
  clusters: FailureClusterSummary[],
  flaky: string[],
  thresholds: ThresholdCheck[],
  gaps: CoverageGap[],
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  for (const cluster of clusters) {
    if (cluster.count > 0) {
      actions.push({
        priority: cluster.count >= 3 ? 'high' : 'medium',
        action: cluster.remediation,
        category: `failure-cluster:${cluster.category}`,
        autoFixable: cluster.category === 'wrong_tool_selection' || cluster.category === 'wrong_arguments',
        estimatedImpact: `Fix ${cluster.count} failing test(s)`,
      });
    }
  }

  if (flaky.length > 0) {
    actions.push({
      priority: 'high',
      action: `Investigate ${flaky.length} flaky test(s): ${flaky.slice(0, 3).join(', ')}`,
      category: 'flaky-tests',
      autoFixable: false,
      estimatedImpact: 'Stabilize test results for reliable CI gating',
    });
  }

  for (const t of thresholds) {
    if (t.suggestion) {
      actions.push({
        priority: 'medium',
        action: t.suggestion,
        category: 'threshold-tuning',
        autoFixable: false,
        estimatedImpact: 'Improve eval reliability',
      });
    }
  }

  for (const gap of gaps.filter((g) => g.autoFixable)) {
    actions.push({
      priority: gap.severity === 'critical' ? 'critical' : gap.severity === 'high' ? 'high' : 'medium',
      action: gap.recommendation,
      category: gap.category,
      autoFixable: true,
      estimatedImpact: gap.description,
    });
  }

  return actions.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a.priority] ?? 4) - (order[b.priority] ?? 4);
  });
}

export function analyzeRunResult(
  result: RunResult,
  coverageGaps: CoverageGap[] = [],
): AnalysisReport {
  const allTests = result.suites.flatMap((s) => s.tests);
  const failureClusters = analyzeFailures(allTests);
  const flakyTests = detectFlakyTests(allTests);
  const thresholdAdequacy = checkThresholdAdequacy(result);
  const suggestedActions = buildSuggestedActions(
    failureClusters,
    flakyTests,
    thresholdAdequacy,
    coverageGaps,
  );

  return {
    timestamp: new Date().toISOString(),
    runId: result.runId,
    overallPassRate: result.overall.passRate,
    failureClusters,
    regressions: [],
    flakyTests,
    costOptimizations: [],
    thresholdAdequacy,
    coverageGaps,
    suggestedActions,
  };
}

export function formatAnalysisReport(report: AnalysisReport): string {
  const lines: string[] = [];
  lines.push('# Evaluation Analysis Report');
  lines.push('');
  lines.push(`**Run:** ${report.runId}`);
  lines.push(`**Pass rate:** ${Math.round(report.overallPassRate * 100)}%`);
  lines.push('');

  if (report.failureClusters.length > 0) {
    lines.push('## Failure Patterns');
    for (const c of report.failureClusters) {
      lines.push(`- **${c.category}** (${c.count} tests): ${c.remediation}`);
    }
    lines.push('');
  }

  if (report.flakyTests.length > 0) {
    lines.push('## Flaky Tests');
    for (const t of report.flakyTests) {
      lines.push(`- ${t}`);
    }
    lines.push('');
  }

  if (report.suggestedActions.length > 0) {
    lines.push('## Suggested Actions');
    for (const a of report.suggestedActions) {
      const fixable = a.autoFixable ? ' [auto-fixable]' : '';
      lines.push(`- [${a.priority.toUpperCase()}] ${a.action}${fixable}`);
    }
  }

  return lines.join('\n');
}
