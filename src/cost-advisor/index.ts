import { calculateCost } from '../pricing/index.js';

export interface CostRecommendation {
  testName: string;
  currentModel: string;
  currentCost: number;
  currentScore: number;
  recommendedModel: string;
  recommendedCost: number;
  projectedScore: number;
  savingsPercent: number;
  savingsUsd: number;
}

export interface CostReport {
  totalCurrentCost: number;
  totalOptimizedCost: number;
  totalSavingsUsd: number;
  totalSavingsPercent: number;
  recommendations: CostRecommendation[];
  modelBreakdown: Array<{ model: string; testCount: number; cost: number }>;
}

interface ComparisonEntry {
  testName: string;
  model: string;
  score: number;
  tokenUsage?: { input: number; output: number };
}

export function analyzeCosts(
  comparisonData: ComparisonEntry[],
  threshold: number = 0.8,
): CostReport {
  const byTest = new Map<string, ComparisonEntry[]>();
  for (const entry of comparisonData) {
    const arr = byTest.get(entry.testName) ?? [];
    arr.push(entry);
    byTest.set(entry.testName, arr);
  }

  const recommendations: CostRecommendation[] = [];
  let totalCurrent = 0;
  let totalOptimized = 0;

  for (const [testName, entries] of byTest) {
    const sorted = [...entries].sort((a, b) => b.score - a.score);
    const current = sorted[0];
    if (!current?.tokenUsage) continue;

    const currentCost = calculateCost(current.model, current.tokenUsage) ?? 0;
    totalCurrent += currentCost;

    const qualifying = entries.filter((e) => e.score >= threshold && e.tokenUsage);
    if (qualifying.length === 0) {
      totalOptimized += currentCost;
      continue;
    }

    const cheapest = qualifying.reduce((best, e) => {
      const cost = calculateCost(e.model, e.tokenUsage!) ?? Infinity;
      const bestCost = calculateCost(best.model, best.tokenUsage!) ?? Infinity;
      return cost < bestCost ? e : best;
    });

    const cheapestCost = calculateCost(cheapest.model, cheapest.tokenUsage!) ?? 0;
    totalOptimized += cheapestCost;

    if (cheapest.model !== current.model && cheapestCost < currentCost) {
      recommendations.push({
        testName,
        currentModel: current.model,
        currentCost,
        currentScore: current.score,
        recommendedModel: cheapest.model,
        recommendedCost: cheapestCost,
        projectedScore: cheapest.score,
        savingsPercent: Math.round(((currentCost - cheapestCost) / currentCost) * 100),
        savingsUsd: currentCost - cheapestCost,
      });
    }
  }

  const modelCounts = new Map<string, { count: number; cost: number }>();
  for (const [, entries] of byTest) {
    for (const e of entries) {
      if (!e.tokenUsage) continue;
      const existing = modelCounts.get(e.model) ?? { count: 0, cost: 0 };
      existing.count++;
      existing.cost += calculateCost(e.model, e.tokenUsage) ?? 0;
      modelCounts.set(e.model, existing);
    }
  }

  return {
    totalCurrentCost: totalCurrent,
    totalOptimizedCost: totalOptimized,
    totalSavingsUsd: totalCurrent - totalOptimized,
    totalSavingsPercent:
      totalCurrent > 0 ? Math.round(((totalCurrent - totalOptimized) / totalCurrent) * 100) : 0,
    recommendations: recommendations.sort((a, b) => b.savingsUsd - a.savingsUsd),
    modelBreakdown: [...modelCounts.entries()].map(([model, data]) => ({
      model,
      testCount: data.count,
      cost: data.cost,
    })),
  };
}

export function formatCostReport(report: CostReport): string {
  const lines: string[] = ['# Cost Optimization Report\n'];

  lines.push(`Current total: $${report.totalCurrentCost.toFixed(4)}`);
  lines.push(`Optimized total: $${report.totalOptimizedCost.toFixed(4)}`);
  lines.push(
    `Potential savings: $${report.totalSavingsUsd.toFixed(4)} (${report.totalSavingsPercent}%)\n`,
  );

  if (report.recommendations.length === 0) {
    lines.push(
      'No cost optimization opportunities found — already using cheapest qualifying models.\n',
    );
    return lines.join('\n');
  }

  lines.push('## Recommendations\n');
  lines.push('| Test | Current Model | Score | → Recommended | Score | Savings |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of report.recommendations) {
    lines.push(
      `| ${r.testName} | ${r.currentModel} | ${r.currentScore.toFixed(2)} | ${r.recommendedModel} | ${r.projectedScore.toFixed(2)} | $${r.savingsUsd.toFixed(4)} (${r.savingsPercent}%) |`,
    );
  }

  return lines.join('\n');
}
