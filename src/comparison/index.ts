import { randomUUID } from 'crypto';
import type {
  Model,
  ComparisonResult,
  ModelComparisonMatrix,
  ModelAggregate,
  RunResult,
} from '../core/types.js';

const DEFAULT_PASS_THRESHOLD = 0.7;

export function buildComparisonFromRuns(
  runs: Array<{ model: Model; result: RunResult }>,
  passThreshold = DEFAULT_PASS_THRESHOLD,
): ComparisonResult {
  const comparisonId = randomUUID();
  const models = runs.map((r) => r.model);

  const testNamesSet = new Set<string>();
  const evaluatorNamesSet = new Set<string>();

  for (const { result } of runs) {
    for (const suite of result.suites) {
      for (const test of suite.tests) {
        testNamesSet.add(test.name);
        for (const er of test.evaluatorResults) {
          evaluatorNamesSet.add(er.evaluator);
        }
      }
    }
  }

  const testNames = [...testNamesSet];
  const evaluatorNames = [...evaluatorNamesSet];
  const cells: Record<string, Record<string, Record<string, number | null>>> = {};
  const aggregates: Record<string, ModelAggregate> = {};

  for (const { model, result } of runs) {
    cells[model.id] = {};
    let totalScore = 0;
    let scoreCount = 0;
    let passCount = 0;
    let failCount = 0;
    let totalLatency = 0;
    let totalCost = 0;
    let hasCost = false;

    const testResultMap = new Map<string, (typeof result.suites)[0]['tests'][0]>();
    for (const suite of result.suites) {
      for (const test of suite.tests) {
        testResultMap.set(test.name, test);
        totalLatency += test.latencyMs;
        if (test.costUsd != null) {
          totalCost += test.costUsd;
          hasCost = true;
        }
      }
    }

    for (const testName of testNames) {
      cells[model.id][testName] = {};
      const test = testResultMap.get(testName);

      for (const evalName of evaluatorNames) {
        const er = test?.evaluatorResults.find((e) => e.evaluator === evalName);
        const score = er?.score ?? null;
        cells[model.id][testName][evalName] = score;

        if (score !== null) {
          totalScore += score;
          scoreCount++;
          if (score >= passThreshold) passCount++;
          else failCount++;
        }
      }
    }

    aggregates[model.id] = {
      model,
      avgScore: scoreCount > 0 ? totalScore / scoreCount : 0,
      passCount,
      failCount,
      totalLatencyMs: totalLatency,
      totalCostUsd: hasCost ? totalCost : null,
    };
  }

  return {
    comparisonId,
    models,
    matrix: { testNames, evaluatorNames, cells, aggregates },
  };
}

export function formatComparisonTable(comparison: ComparisonResult): string {
  const { matrix, models } = comparison;
  const lines: string[] = [];

  const header = ['Test', ...models.map((m) => m.id)];
  lines.push(header.join(' | '));
  lines.push(header.map((h) => '-'.repeat(h.length)).join(' | '));

  for (const testName of matrix.testNames) {
    const row = [testName];
    for (const model of models) {
      const evalScores = matrix.cells[model.id]?.[testName] ?? {};
      const scores = Object.values(evalScores).filter((s): s is number => s !== null);
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      row.push(avg.toFixed(3));
    }
    lines.push(row.join(' | '));
  }

  lines.push('');
  lines.push('Aggregates:');
  for (const model of models) {
    const agg = matrix.aggregates[model.id];
    if (!agg) continue;
    lines.push(
      `  ${model.id}: avg=${agg.avgScore.toFixed(3)} pass=${agg.passCount} fail=${agg.failCount} latency=${agg.totalLatencyMs.toFixed(0)}ms${agg.totalCostUsd != null ? ` cost=$${agg.totalCostUsd.toFixed(4)}` : ''}`,
    );
  }

  return lines.join('\n');
}
