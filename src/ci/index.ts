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

export interface EvaluateCiOptions {
  firstTryPassRate?: number;
}

export function evaluateCi(
  tests: TestResult[],
  thresholds: CiThresholds,
  options?: EvaluateCiOptions,
): CiResult {
  const violations: CiViolation[] = [];
  const securityViolations: CiViolation[] = [];

  const allScores: number[] = [];
  const byEvaluator = new Map<string, number[]>();

  for (const test of tests) {
    for (const er of test.evaluatorResults) {
      if (er.skipped) continue;
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

  if (thresholds.requiredPass?.length) {
    for (const evalName of thresholds.requiredPass) {
      const scores = byEvaluator.get(evalName) ?? [];
      for (let i = 0; i < scores.length; i++) {
        if (scores[i] < 1.0) {
          securityViolations.push({
            metric: `required_pass.${evalName}`,
            evaluator: evalName,
            actual: scores[i],
            threshold: 1.0,
            testCase: tests[i]?.name,
          });
        }
      }
    }
  }

  const firstTryPassRate = options?.firstTryPassRate;

  if (firstTryPassRate != null && thresholds.firstTryPassRate != null) {
    if (firstTryPassRate < thresholds.firstTryPassRate) {
      violations.push({
        metric: 'first_try_pass_rate',
        actual: firstTryPassRate,
        threshold: thresholds.firstTryPassRate,
      });
    }
  }

  if (firstTryPassRate != null && thresholds.phaseGate) {
    const gate = thresholds.phaseGate;
    if (gate.first_try_pass_rate != null && firstTryPassRate < gate.first_try_pass_rate) {
      violations.push({
        metric: 'phase_gate.first_try_pass_rate',
        actual: firstTryPassRate,
        threshold: gate.first_try_pass_rate,
      });
    }
    if (gate.e2e_completion_rate != null) {
      const passRate = tests.length > 0 ? tests.filter((t) => t.pass).length / tests.length : 0;
      if (passRate < gate.e2e_completion_rate) {
        violations.push({
          metric: 'phase_gate.e2e_completion_rate',
          actual: passRate,
          threshold: gate.e2e_completion_rate,
        });
      }
    }
  }

  const passed = violations.length === 0 && securityViolations.length === 0;
  const allViolations = [...securityViolations, ...violations];

  const lines: string[] = [];

  if (securityViolations.length > 0) {
    lines.push('Security & Compliance: FAILED');
    lines.push(`  ${securityViolations.length} required-pass violation(s):`);
    for (const v of securityViolations) {
      const testInfo = v.testCase ? ` (test: ${v.testCase})` : '';
      lines.push(`    ✗ ${v.evaluator}: score ${v.actual} !== 1.0${testInfo}`);
    }
  }

  if (violations.length > 0) {
    lines.push(`${violations.length} threshold violation(s):`);
    for (const v of violations) {
      const isUpperBound = v.metric.startsWith('latency') || v.metric.startsWith('cost');
      const isRate = v.metric.includes('pass_rate') || v.metric.includes('completion_rate');
      const actualStr = isUpperBound
        ? `${v.actual.toFixed(0)}ms`
        : isRate
          ? `${(v.actual * 100).toFixed(1)}%`
          : v.actual.toFixed(3);
      const threshStr = isUpperBound
        ? `${v.threshold.toFixed(0)}ms`
        : isRate
          ? `${(v.threshold * 100).toFixed(1)}%`
          : v.threshold.toFixed(3);
      const op = isUpperBound ? '>' : '<';
      lines.push(`    ✗ ${v.metric}: ${actualStr} ${op} threshold ${threshStr}`);
    }
  }

  if (passed) {
    lines.push(`All CI thresholds passed (${allScores.length} scores checked)`);
    if (firstTryPassRate != null) {
      lines.push(`  First-try pass rate: ${(firstTryPassRate * 100).toFixed(1)}%`);
    }
  }

  const summary = lines.join('\n');

  return { passed, violations: allViolations, summary };
}

export function convertFlatThresholds(flat: Record<string, number>): CiThresholds {
  const evaluators: Record<string, { avg: number }> = {};
  for (const [name, value] of Object.entries(flat)) {
    evaluators[name] = { avg: value };
  }
  return { evaluators };
}
