import { describe, it, expect } from 'vitest';
import {
  computeFairAggregates,
  formatFairBenchmarkTable,
  DEFAULT_FAIR_CONFIG,
} from './fair-benchmark.js';
import type { FairTaskResult, FairBenchmarkResult } from './fair-benchmark.js';

function makeTask(name: string, scores: Record<string, number>): FairTaskResult {
  const results: FairTaskResult['results'] = {};
  for (const [model, score] of Object.entries(scores)) {
    results[model] = {
      score,
      latencyMs: 100 + Math.round(score * 200),
      costUsd: score * 0.01,
      pass: score >= 0.7,
    };
  }
  return { taskName: name, results };
}

describe('computeFairAggregates', () => {
  it('computes aggregates for 3 models across 5 tasks', () => {
    const models = ['gpt-4', 'claude-3', 'gemini'];
    const tasks: FairTaskResult[] = [
      makeTask('task-1', { 'gpt-4': 0.9, 'claude-3': 0.85, gemini: 0.7 }),
      makeTask('task-2', { 'gpt-4': 0.8, 'claude-3': 0.95, gemini: 0.6 }),
      makeTask('task-3', { 'gpt-4': 0.7, 'claude-3': 0.9, gemini: 0.85 }),
      makeTask('task-4', { 'gpt-4': 0.95, 'claude-3': 0.8, gemini: 0.75 }),
      makeTask('task-5', { 'gpt-4': 0.85, 'claude-3': 0.88, gemini: 0.92 }),
    ];

    const agg = computeFairAggregates(tasks, models);

    expect(Object.keys(agg)).toHaveLength(3);

    expect(agg['gpt-4'].avgScore).toBeCloseTo(0.84, 2);
    expect(agg['claude-3'].avgScore).toBeCloseTo(0.876, 2);
    expect(agg.gemini.avgScore).toBeCloseTo(0.764, 2);

    expect(agg['gpt-4'].passRate).toBe(1.0);
    expect(agg.gemini.passRate).toBe(0.8);

    expect(agg['gpt-4'].wins).toBe(2);
    expect(agg['claude-3'].wins).toBe(2);
    expect(agg.gemini.wins).toBe(1);

    expect(agg['gpt-4'].medianLatencyMs).toBeGreaterThan(0);
    expect(agg['claude-3'].p95LatencyMs).toBeGreaterThanOrEqual(agg['claude-3'].medianLatencyMs);
    expect(agg.gemini.totalCostUsd).toBeGreaterThan(0);
  });

  it('assigns medals based on win count', () => {
    const models = ['a', 'b', 'c'];
    const tasks: FairTaskResult[] = [
      makeTask('t1', { a: 0.9, b: 0.8, c: 0.7 }),
      makeTask('t2', { a: 0.9, b: 0.85, c: 0.6 }),
      makeTask('t3', { a: 0.5, b: 0.95, c: 0.3 }),
    ];

    const agg = computeFairAggregates(tasks, models);

    expect(agg.a.wins).toBe(2);
    expect(agg.b.wins).toBe(1);
    expect(agg.c.wins).toBe(0);

    expect(agg.a.medal).toBe('gold');
    expect(agg.b.medal).toBe('silver');
    expect(agg.c.medal).toBe('bronze');
  });

  it('handles ties in medal assignment', () => {
    const models = ['x', 'y', 'z'];
    const tasks: FairTaskResult[] = [
      makeTask('t1', { x: 0.9, y: 0.9, z: 0.5 }),
      makeTask('t2', { x: 0.8, y: 0.8, z: 0.5 }),
    ];

    const agg = computeFairAggregates(tasks, models);

    expect(agg.x.wins).toBe(2);
    expect(agg.y.wins).toBe(2);
    expect(agg.z.wins).toBe(0);

    expect(agg.x.medal).toBe('gold');
    expect(agg.y.medal).toBe('gold');
    expect(agg.z.medal).toBe('bronze');
  });

  it('handles single model', () => {
    const models = ['solo'];
    const tasks: FairTaskResult[] = [
      makeTask('t1', { solo: 0.9 }),
      makeTask('t2', { solo: 0.6 }),
    ];

    const agg = computeFairAggregates(tasks, models);

    expect(agg.solo.wins).toBe(2);
    expect(agg.solo.medal).toBe('gold');
    expect(agg.solo.avgScore).toBeCloseTo(0.75, 2);
    expect(agg.solo.passRate).toBe(0.5);
  });

  it('handles no task results', () => {
    const models = ['empty'];
    const agg = computeFairAggregates([], models);

    expect(agg.empty.avgScore).toBe(0);
    expect(agg.empty.medianLatencyMs).toBe(0);
    expect(agg.empty.p95LatencyMs).toBe(0);
    expect(agg.empty.totalCostUsd).toBeNull();
    expect(agg.empty.passRate).toBe(0);
    expect(agg.empty.wins).toBe(0);
    expect(agg.empty.medal).toBe('gold');
  });
});

describe('formatFairBenchmarkTable', () => {
  it('produces a valid table with header and separator', () => {
    const tasks: FairTaskResult[] = [
      makeTask('t1', { alpha: 0.9, beta: 0.8 }),
      makeTask('t2', { alpha: 0.7, beta: 0.95 }),
    ];
    const aggregates = computeFairAggregates(tasks, ['alpha', 'beta']);

    const benchResult: FairBenchmarkResult = {
      config: DEFAULT_FAIR_CONFIG,
      warmupDiscarded: 1,
      taskResults: tasks,
      aggregates,
    };

    const table = formatFairBenchmarkTable(benchResult);
    const lines = table.split('\n');

    expect(lines[0]).toContain('Model');
    expect(lines[0]).toContain('Avg Score');
    expect(lines[0]).toContain('Pass Rate');
    expect(lines[0]).toContain('Wins');
    expect(lines[1]).toMatch(/^─+$/);
    expect(table).toContain('alpha');
    expect(table).toContain('beta');
    expect(table).toContain('Warmup runs discarded: 1');
    expect(table).toContain('Tasks: 2');
  });

  it('returns placeholder for empty results', () => {
    const benchResult: FairBenchmarkResult = {
      config: DEFAULT_FAIR_CONFIG,
      warmupDiscarded: 0,
      taskResults: [],
      aggregates: {},
    };

    const table = formatFairBenchmarkTable(benchResult);
    expect(table).toBe('No results to display.');
  });

  it('includes medal emoji for top models', () => {
    const tasks: FairTaskResult[] = [
      makeTask('t1', { first: 0.95, second: 0.8, third: 0.6 }),
      makeTask('t2', { first: 0.9, second: 0.85, third: 0.7 }),
      makeTask('t3', { first: 0.5, second: 0.6, third: 0.99 }),
    ];
    const aggregates = computeFairAggregates(tasks, ['first', 'second', 'third']);

    const benchResult: FairBenchmarkResult = {
      config: DEFAULT_FAIR_CONFIG,
      warmupDiscarded: 0,
      taskResults: tasks,
      aggregates,
    };

    const table = formatFairBenchmarkTable(benchResult);
    expect(table).toContain('\u{1F947}');
    expect(table).toContain('\u{1F948}');
    expect(table).toContain('\u{1F949}');
  });
});
