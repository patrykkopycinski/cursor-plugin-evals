import type { RunResult } from '../core/types.js';
import type { Leaderboard, LeaderboardEntry } from './types.js';

const PROVIDER_PATTERNS: Array<[RegExp, string]> = [
  [/^gpt-|^o[1-9]|^chatgpt/i, 'openai'],
  [/^claude/i, 'anthropic'],
  [/^gemini|^palm/i, 'google'],
  [/^llama|^code-?llama/i, 'meta'],
  [/^mistral|^mixtral/i, 'mistral'],
  [/^command/i, 'cohere'],
];

function inferProvider(modelId: string): string {
  for (const [pattern, provider] of PROVIDER_PATTERNS) {
    if (pattern.test(modelId)) return provider;
  }
  return 'other';
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

interface ModelAccumulator {
  scores: number[];
  latencies: number[];
  costs: number[];
  hasCost: boolean;
  passCount: number;
  totalTests: number;
  timestamps: string[];
  evaluatorScores: Record<string, number[]>;
}

export function buildLeaderboard(
  runs: Array<{ model: string; result: RunResult }>,
  name?: string,
  description?: string,
): Leaderboard {
  const accumulators = new Map<string, ModelAccumulator>();
  const allEvaluators = new Set<string>();
  const allSuites = new Set<string>();
  const allTimestamps: string[] = [];
  let totalTests = 0;

  for (const { model, result } of runs) {
    allTimestamps.push(result.timestamp);

    if (!accumulators.has(model)) {
      accumulators.set(model, {
        scores: [],
        latencies: [],
        costs: [],
        hasCost: false,
        passCount: 0,
        totalTests: 0,
        timestamps: [],
        evaluatorScores: {},
      });
    }

    const acc = accumulators.get(model)!;
    acc.timestamps.push(result.timestamp);

    for (const suite of result.suites) {
      allSuites.add(suite.name);

      for (const test of suite.tests) {
        if (test.skipped) continue;
        totalTests++;
        acc.totalTests++;

        if (test.pass) acc.passCount++;
        acc.latencies.push(test.latencyMs);

        if (test.costUsd != null) {
          acc.costs.push(test.costUsd);
          acc.hasCost = true;
        }

        for (const er of test.evaluatorResults) {
          allEvaluators.add(er.evaluator);
          if (!acc.evaluatorScores[er.evaluator]) {
            acc.evaluatorScores[er.evaluator] = [];
          }
          acc.evaluatorScores[er.evaluator].push(er.score);
        }

        const testScores = test.evaluatorResults.map((e) => e.score);
        if (testScores.length > 0) {
          acc.scores.push(testScores.reduce((a, b) => a + b, 0) / testScores.length);
        }
      }
    }
  }

  const entries: LeaderboardEntry[] = [];

  for (const [modelId, acc] of accumulators) {
    const avgScore =
      acc.scores.length > 0 ? acc.scores.reduce((a, b) => a + b, 0) / acc.scores.length : 0;
    const passRate = acc.totalTests > 0 ? acc.passCount / acc.totalTests : 0;
    const avgLatencyMs =
      acc.latencies.length > 0
        ? acc.latencies.reduce((a, b) => a + b, 0) / acc.latencies.length
        : 0;
    const p95LatencyMs = percentile(acc.latencies, 95);
    const avgCostUsd = acc.hasCost
      ? acc.costs.reduce((a, b) => a + b, 0) / acc.costs.length
      : null;

    const scores: Record<string, number> = {};
    for (const [evaluator, vals] of Object.entries(acc.evaluatorScores)) {
      scores[evaluator] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    const lastUpdated =
      acc.timestamps.length > 0
        ? acc.timestamps.sort().reverse()[0]
        : new Date().toISOString();

    entries.push({
      modelId,
      modelProvider: inferProvider(modelId),
      avgScore,
      passRate,
      avgLatencyMs,
      p95LatencyMs,
      avgCostUsd,
      totalRuns: acc.timestamps.length,
      lastUpdated,
      scores,
      rank: 0,
      badge: null,
    });
  }

  entries.sort((a, b) => b.avgScore - a.avgScore);

  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
  }

  if (entries.length >= 1) entries[0].badge = 'gold';
  if (entries.length >= 2) entries[1].badge = 'silver';
  if (entries.length >= 3) entries[2].badge = 'bronze';

  const sortedTimestamps = allTimestamps.sort();
  const now = new Date().toISOString();

  return {
    name: name ?? 'MCP Plugin Leaderboard',
    description: description ?? 'Model performance comparison across evaluation runs',
    lastUpdated: now,
    entries,
    metadata: {
      totalTests,
      evaluators: [...allEvaluators].sort(),
      suites: [...allSuites].sort(),
      dateRange: {
        from: sortedTimestamps[0] ?? now,
        to: sortedTimestamps[sortedTimestamps.length - 1] ?? now,
      },
    },
  };
}
