import type { CiThresholds, CiViolation, CiResult, TestResult } from '../core/types.js';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function checkStatThresholds(
  values: number[],
  thresholds: Record<string, number | undefined>,
  prefix: string,
): CiViolation[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const violations: CiViolation[] = [];
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  const checks: Array<{ metric: string; actual: number }> = [
    { metric: 'avg', actual: avg },
    { metric: 'min', actual: sorted[0] },
    { metric: 'max', actual: sorted[sorted.length - 1] },
    { metric: 'p50', actual: percentile(sorted, 50) },
    { metric: 'p95', actual: percentile(sorted, 95) },
    { metric: 'p99', actual: percentile(sorted, 99) },
  ];

  for (const { metric, actual } of checks) {
    const threshold = thresholds[metric];
    if (threshold == null) continue;
    if (actual < threshold) {
      violations.push({ metric: `${prefix}.${metric}`, actual, threshold });
    }
  }

  return violations;
}

export function evaluateCi(tests: TestResult[], thresholds: CiThresholds): CiResult {
  const violations: CiViolation[] = [];

  const allScores: number[] = [];
  const byEvaluator = new Map<string, number[]>();

  for (const test of tests) {
    for (const er of test.evaluatorResults) {
      allScores.push(er.score);
      const arr = byEvaluator.get(er.evaluator) ?? [];
      arr.push(er.score);
      byEvaluator.set(er.evaluator, arr);
    }
  }

  if (thresholds.score) {
    violations.push(
      ...checkStatThresholds(
        allScores,
        thresholds.score as Record<string, number | undefined>,
        'score',
      ),
    );
  }

  if (thresholds.latency) {
    const latencies = tests.map((t) => t.latencyMs);
    const sorted = [...latencies].sort((a, b) => a - b);

    if (thresholds.latency.avg != null) {
      const avg =
        latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
      if (avg > thresholds.latency.avg) {
        violations.push({ metric: 'latency.avg', actual: avg, threshold: thresholds.latency.avg });
      }
    }
    if (thresholds.latency.p95 != null && sorted.length > 0) {
      const p95 = percentile(sorted, 95);
      if (p95 > thresholds.latency.p95) {
        violations.push({ metric: 'latency.p95', actual: p95, threshold: thresholds.latency.p95 });
      }
    }
  }

  if (thresholds.cost?.max != null) {
    const totalCost = tests.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
    if (totalCost > thresholds.cost.max) {
      violations.push({ metric: 'cost.total', actual: totalCost, threshold: thresholds.cost.max });
    }
  }

  if (thresholds.evaluators) {
    for (const [evalName, evalThresholds] of Object.entries(thresholds.evaluators)) {
      const scores = byEvaluator.get(evalName) ?? [];
      if (scores.length === 0) continue;
      const evalViolations = checkStatThresholds(
        scores,
        evalThresholds as Record<string, number | undefined>,
        `evaluators.${evalName}`,
      );
      violations.push(...evalViolations);
    }
  }

  const passed = violations.length === 0;
  const summary = passed
    ? 'All CI thresholds passed'
    : `${violations.length} threshold violation(s): ${violations
        .map((v) => {
          const isUpperBound = v.metric.startsWith('latency') || v.metric.startsWith('cost');
          const op = isUpperBound ? '>' : '<';
          return `${v.metric} (${v.actual.toFixed(3)} ${op} ${v.threshold})`;
        })
        .join(', ')}`;

  return { passed, violations, summary };
}

export function convertFlatThresholds(flat: Record<string, number>): CiThresholds {
  const evaluators: Record<string, { avg: number }> = {};
  for (const [name, value] of Object.entries(flat)) {
    evaluators[name] = { avg: value };
  }
  return { evaluators };
}
