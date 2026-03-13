export interface FairBenchmarkConfig {
  sequential: boolean;
  parallelProviders: boolean;
  warmupRuns: number;
  cooldownMs: number;
}

export const DEFAULT_FAIR_CONFIG: FairBenchmarkConfig = {
  sequential: true,
  parallelProviders: true,
  warmupRuns: 1,
  cooldownMs: 500,
};

export interface FairBenchmarkResult {
  config: FairBenchmarkConfig;
  warmupDiscarded: number;
  taskResults: FairTaskResult[];
  aggregates: Record<string, FairAggregate>;
}

export interface FairTaskResult {
  taskName: string;
  results: Record<
    string,
    { score: number; latencyMs: number; costUsd: number | null; pass: boolean }
  >;
}

export interface FairAggregate {
  modelId: string;
  avgScore: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number | null;
  passRate: number;
  wins: number;
  medal: 'gold' | 'silver' | 'bronze' | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function computeFairAggregates(
  taskResults: FairTaskResult[],
  models: string[],
): Record<string, FairAggregate> {
  const aggregates: Record<string, FairAggregate> = {};

  const winCounts: Record<string, number> = {};
  for (const model of models) {
    winCounts[model] = 0;
  }

  for (const task of taskResults) {
    let bestScore = -Infinity;
    const topModels: string[] = [];

    for (const model of models) {
      const r = task.results[model];
      if (!r) continue;
      if (r.score > bestScore) {
        bestScore = r.score;
        topModels.length = 0;
        topModels.push(model);
      } else if (r.score === bestScore) {
        topModels.push(model);
      }
    }

    for (const m of topModels) {
      winCounts[m]++;
    }
  }

  for (const model of models) {
    const scores: number[] = [];
    const latencies: number[] = [];
    let totalCost = 0;
    let hasCost = false;
    let passCount = 0;
    let total = 0;

    for (const task of taskResults) {
      const r = task.results[model];
      if (!r) continue;
      total++;
      scores.push(r.score);
      latencies.push(r.latencyMs);
      if (r.pass) passCount++;
      if (r.costUsd != null) {
        totalCost += r.costUsd;
        hasCost = true;
      }
    }

    aggregates[model] = {
      modelId: model,
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      medianLatencyMs: median(latencies),
      p95LatencyMs: percentile(latencies, 95),
      totalCostUsd: hasCost ? totalCost : null,
      passRate: total > 0 ? passCount / total : 0,
      wins: winCounts[model],
      medal: null,
    };
  }

  const ranked = [...models].sort((a, b) => winCounts[b] - winCounts[a]);
  if (ranked.length >= 1 && aggregates[ranked[0]]) {
    aggregates[ranked[0]].medal = 'gold';
  }
  if (ranked.length >= 2 && aggregates[ranked[1]]) {
    if (winCounts[ranked[1]] === winCounts[ranked[0]]) {
      aggregates[ranked[1]].medal = 'gold';
    } else {
      aggregates[ranked[1]].medal = 'silver';
    }
  }
  if (ranked.length >= 3 && aggregates[ranked[2]]) {
    if (winCounts[ranked[2]] === winCounts[ranked[0]]) {
      aggregates[ranked[2]].medal = 'gold';
    } else if (winCounts[ranked[2]] === winCounts[ranked[1]]) {
      aggregates[ranked[2]].medal = aggregates[ranked[1]].medal;
    } else {
      aggregates[ranked[2]].medal = 'bronze';
    }
  }

  return aggregates;
}

const MEDAL_ICONS: Record<string, string> = {
  gold: '\u{1F947}',
  silver: '\u{1F948}',
  bronze: '\u{1F949}',
};

const SPARKLINE_CHARS = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];

function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (SPARKLINE_CHARS.length - 1));
      return SPARKLINE_CHARS[idx];
    })
    .join('');
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

export function formatFairBenchmarkTable(result: FairBenchmarkResult): string {
  const lines: string[] = [];
  const models = Object.keys(result.aggregates);

  if (models.length === 0) {
    return 'No results to display.';
  }

  const scoresByModel: Record<string, number[]> = {};
  for (const model of models) {
    scoresByModel[model] = [];
  }
  for (const task of result.taskResults) {
    for (const model of models) {
      const r = task.results[model];
      if (r) scoresByModel[model].push(r.score);
    }
  }

  const cols = {
    model: 'Model',
    medal: '',
    avgScore: 'Avg Score',
    passRate: 'Pass Rate',
    wins: 'Wins',
    medianLat: 'Med Lat',
    p95Lat: 'P95 Lat',
    cost: 'Cost',
    spark: 'Trend',
  };

  const modelWidth = Math.max(cols.model.length, ...models.map((m) => m.length));

  lines.push(
    `${padRight(cols.model, modelWidth)}  ${cols.medal.padEnd(2)}  ${padLeft(cols.avgScore, 9)}  ${padLeft(cols.passRate, 9)}  ${padLeft(cols.wins, 4)}  ${padLeft(cols.medianLat, 8)}  ${padLeft(cols.p95Lat, 8)}  ${padLeft(cols.cost, 8)}  ${cols.spark}`,
  );

  const separatorWidth = modelWidth + 2 + 2 + 2 + 9 + 2 + 9 + 2 + 4 + 2 + 8 + 2 + 8 + 2 + 8 + 2 + 8;
  lines.push('\u2500'.repeat(separatorWidth));

  const sorted = [...models].sort(
    (a, b) => result.aggregates[b].wins - result.aggregates[a].wins,
  );

  for (const model of sorted) {
    const agg = result.aggregates[model];
    const medalStr = agg.medal ? MEDAL_ICONS[agg.medal] : '  ';
    const costStr = agg.totalCostUsd != null ? `$${agg.totalCostUsd.toFixed(4)}` : 'n/a';
    const spark = sparkline(scoresByModel[model]);

    lines.push(
      `${padRight(model, modelWidth)}  ${medalStr}  ${padLeft(agg.avgScore.toFixed(3), 9)}  ${padLeft((agg.passRate * 100).toFixed(1) + '%', 9)}  ${padLeft(String(agg.wins), 4)}  ${padLeft(agg.medianLatencyMs.toFixed(0) + 'ms', 8)}  ${padLeft(agg.p95LatencyMs.toFixed(0) + 'ms', 8)}  ${padLeft(costStr, 8)}  ${spark}`,
    );
  }

  lines.push('');
  lines.push(
    `Warmup runs discarded: ${result.warmupDiscarded} | Tasks: ${result.taskResults.length} | Config: sequential=${result.config.sequential}, parallel=${result.config.parallelProviders}`,
  );

  return lines.join('\n');
}
