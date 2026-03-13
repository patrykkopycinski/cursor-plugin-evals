import { describe, it, expect } from 'vitest';
import { buildLeaderboard } from './builder.js';
import { formatLeaderboardTerminal, formatLeaderboardMarkdown, formatLeaderboardHtml } from './formatter.js';
import type { RunResult } from '../core/types.js';
import type { Leaderboard } from './types.js';

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runId: 'run-1',
    timestamp: '2025-01-15T10:00:00.000Z',
    config: 'test-config',
    suites: [],
    overall: { total: 0, passed: 0, failed: 0, skipped: 0, passRate: 0, duration: 0 },
    ...overrides,
  };
}

function makeRun(
  model: string,
  tests: Array<{ name: string; pass: boolean; score: number; latencyMs: number; costUsd?: number; evaluator?: string }>,
  timestamp?: string,
): { model: string; result: RunResult } {
  return {
    model,
    result: makeRunResult({
      timestamp: timestamp ?? '2025-01-15T10:00:00.000Z',
      suites: [
        {
          name: 'test-suite',
          layer: 'llm',
          passRate: tests.filter((t) => t.pass).length / (tests.length || 1),
          duration: tests.reduce((a, t) => a + t.latencyMs, 0),
          tests: tests.map((t) => ({
            name: t.name,
            suite: 'test-suite',
            layer: 'llm' as const,
            pass: t.pass,
            toolCalls: [],
            evaluatorResults: [
              {
                evaluator: t.evaluator ?? 'tool-selection',
                score: t.score,
                pass: t.pass,
              },
            ],
            latencyMs: t.latencyMs,
            costUsd: t.costUsd,
          })),
          evaluatorSummary: {},
        },
      ],
      overall: {
        total: tests.length,
        passed: tests.filter((t) => t.pass).length,
        failed: tests.filter((t) => !t.pass).length,
        skipped: 0,
        passRate: tests.filter((t) => t.pass).length / (tests.length || 1),
        duration: tests.reduce((a, t) => a + t.latencyMs, 0),
      },
    }),
  };
}

describe('buildLeaderboard', () => {
  it('produces correct rankings for 3 models', () => {
    const runs = [
      makeRun('gpt-4', [
        { name: 't1', pass: true, score: 0.95, latencyMs: 200, costUsd: 0.01 },
        { name: 't2', pass: true, score: 0.85, latencyMs: 300, costUsd: 0.02 },
      ]),
      makeRun('claude-3', [
        { name: 't1', pass: true, score: 0.90, latencyMs: 150, costUsd: 0.015 },
        { name: 't2', pass: false, score: 0.60, latencyMs: 250, costUsd: 0.01 },
      ]),
      makeRun('gemini-pro', [
        { name: 't1', pass: true, score: 0.80, latencyMs: 100 },
        { name: 't2', pass: true, score: 0.70, latencyMs: 180 },
      ]),
    ];

    const lb = buildLeaderboard(runs);

    expect(lb.entries).toHaveLength(3);
    expect(lb.entries[0].modelId).toBe('gpt-4');
    expect(lb.entries[0].rank).toBe(1);
    expect(lb.entries[1].modelId).toBe('claude-3');
    expect(lb.entries[1].rank).toBe(2);
    expect(lb.entries[2].modelId).toBe('gemini-pro');
    expect(lb.entries[2].rank).toBe(3);

    expect(lb.entries[0].avgScore).toBeCloseTo(0.9, 2);
    expect(lb.entries[1].avgScore).toBeCloseTo(0.75, 2);
    expect(lb.entries[2].avgScore).toBeCloseTo(0.75, 2);
  });

  it('assigns gold/silver/bronze badges to top 3', () => {
    const runs = [
      makeRun('model-a', [{ name: 't1', pass: true, score: 0.9, latencyMs: 100 }]),
      makeRun('model-b', [{ name: 't1', pass: true, score: 0.8, latencyMs: 100 }]),
      makeRun('model-c', [{ name: 't1', pass: true, score: 0.7, latencyMs: 100 }]),
      makeRun('model-d', [{ name: 't1', pass: true, score: 0.6, latencyMs: 100 }]),
    ];

    const lb = buildLeaderboard(runs);

    expect(lb.entries[0].badge).toBe('gold');
    expect(lb.entries[1].badge).toBe('silver');
    expect(lb.entries[2].badge).toBe('bronze');
    expect(lb.entries[3].badge).toBeNull();
  });

  it('aggregates per-evaluator score averages', () => {
    const runs = [
      makeRun('gpt-4', [
        { name: 't1', pass: true, score: 0.9, latencyMs: 100, evaluator: 'tool-selection' },
        { name: 't2', pass: true, score: 0.8, latencyMs: 100, evaluator: 'response-quality' },
      ]),
    ];

    const lb = buildLeaderboard(runs);

    expect(lb.entries[0].scores['tool-selection']).toBeCloseTo(0.9, 2);
    expect(lb.entries[0].scores['response-quality']).toBeCloseTo(0.8, 2);
    expect(lb.metadata.evaluators).toContain('tool-selection');
    expect(lb.metadata.evaluators).toContain('response-quality');
  });

  it('handles single model', () => {
    const runs = [
      makeRun('solo-model', [
        { name: 't1', pass: true, score: 0.85, latencyMs: 200, costUsd: 0.005 },
      ]),
    ];

    const lb = buildLeaderboard(runs);

    expect(lb.entries).toHaveLength(1);
    expect(lb.entries[0].rank).toBe(1);
    expect(lb.entries[0].badge).toBe('gold');
    expect(lb.entries[0].totalRuns).toBe(1);
    expect(lb.entries[0].avgCostUsd).toBeCloseTo(0.005, 4);
  });

  it('handles no runs', () => {
    const lb = buildLeaderboard([]);

    expect(lb.entries).toHaveLength(0);
    expect(lb.metadata.totalTests).toBe(0);
    expect(lb.metadata.evaluators).toHaveLength(0);
    expect(lb.metadata.suites).toHaveLength(0);
  });

  it('infers model provider from model name', () => {
    const runs = [
      makeRun('gpt-4o', [{ name: 't1', pass: true, score: 0.9, latencyMs: 100 }]),
      makeRun('claude-3.5-sonnet', [{ name: 't1', pass: true, score: 0.8, latencyMs: 100 }]),
      makeRun('gemini-1.5-pro', [{ name: 't1', pass: true, score: 0.7, latencyMs: 100 }]),
      makeRun('llama-3.1-70b', [{ name: 't1', pass: true, score: 0.6, latencyMs: 100 }]),
      makeRun('custom-model', [{ name: 't1', pass: true, score: 0.5, latencyMs: 100 }]),
    ];

    const lb = buildLeaderboard(runs);
    const byModel = new Map(lb.entries.map((e) => [e.modelId, e]));

    expect(byModel.get('gpt-4o')!.modelProvider).toBe('openai');
    expect(byModel.get('claude-3.5-sonnet')!.modelProvider).toBe('anthropic');
    expect(byModel.get('gemini-1.5-pro')!.modelProvider).toBe('google');
    expect(byModel.get('llama-3.1-70b')!.modelProvider).toBe('meta');
    expect(byModel.get('custom-model')!.modelProvider).toBe('other');
  });

  it('computes latency stats correctly', () => {
    const runs = [
      makeRun('model-a', [
        { name: 't1', pass: true, score: 0.9, latencyMs: 100 },
        { name: 't2', pass: true, score: 0.8, latencyMs: 200 },
        { name: 't3', pass: true, score: 0.7, latencyMs: 500 },
      ]),
    ];

    const lb = buildLeaderboard(runs);
    const entry = lb.entries[0];

    expect(entry.avgLatencyMs).toBeCloseTo(266.67, 0);
    expect(entry.p95LatencyMs).toBe(500);
  });

  it('uses custom name and description', () => {
    const lb = buildLeaderboard([], 'My Board', 'Custom desc');

    expect(lb.name).toBe('My Board');
    expect(lb.description).toBe('Custom desc');
  });

  it('collects metadata from multiple runs', () => {
    const runs = [
      makeRun('gpt-4', [{ name: 't1', pass: true, score: 0.9, latencyMs: 100 }], '2025-01-01T00:00:00.000Z'),
      makeRun('claude-3', [{ name: 't1', pass: true, score: 0.8, latencyMs: 100 }], '2025-01-15T00:00:00.000Z'),
    ];

    const lb = buildLeaderboard(runs);

    expect(lb.metadata.suites).toContain('test-suite');
    expect(lb.metadata.dateRange.from).toBe('2025-01-01T00:00:00.000Z');
    expect(lb.metadata.dateRange.to).toBe('2025-01-15T00:00:00.000Z');
  });
});

describe('formatLeaderboardTerminal', () => {
  function makeLb(): Leaderboard {
    return buildLeaderboard([
      makeRun('gpt-4', [
        { name: 't1', pass: true, score: 0.95, latencyMs: 200, costUsd: 0.01 },
        { name: 't2', pass: true, score: 0.85, latencyMs: 300, costUsd: 0.02 },
      ]),
      makeRun('claude-3', [
        { name: 't1', pass: true, score: 0.80, latencyMs: 150 },
        { name: 't2', pass: false, score: 0.60, latencyMs: 250 },
      ]),
    ]);
  }

  it('produces a table with headers', () => {
    const output = formatLeaderboardTerminal(makeLb());
    expect(output).toContain('Model');
    expect(output).toContain('Score');
    expect(output).toContain('Pass%');
    expect(output).toContain('gpt-4');
    expect(output).toContain('claude-3');
  });

  it('includes medal emojis', () => {
    const output = formatLeaderboardTerminal(makeLb());
    expect(output).toContain('\u{1F947}');
    expect(output).toContain('\u{1F948}');
  });

  it('includes bar chart characters', () => {
    const output = formatLeaderboardTerminal(makeLb());
    expect(output).toMatch(/[\u2581-\u2588]/);
  });

  it('returns placeholder for empty leaderboard', () => {
    const lb = buildLeaderboard([]);
    expect(formatLeaderboardTerminal(lb)).toBe('No leaderboard entries.');
  });
});

describe('formatLeaderboardMarkdown', () => {
  function makeLb(): Leaderboard {
    return buildLeaderboard([
      makeRun('gpt-4', [{ name: 't1', pass: true, score: 0.9, latencyMs: 200, costUsd: 0.01 }]),
      makeRun('claude-3', [{ name: 't1', pass: true, score: 0.8, latencyMs: 150, costUsd: 0.005 }]),
    ]);
  }

  it('produces valid markdown with table', () => {
    const output = formatLeaderboardMarkdown(makeLb());
    expect(output).toContain('| Rank |');
    expect(output).toContain('|-----:');
    expect(output).toContain('**gpt-4**');
    expect(output).toContain('**claude-3**');
  });

  it('includes per-evaluator scores section', () => {
    const output = formatLeaderboardMarkdown(makeLb());
    expect(output).toContain('Per-Evaluator Scores');
    expect(output).toContain('tool-selection');
  });

  it('includes metadata footer', () => {
    const output = formatLeaderboardMarkdown(makeLb());
    expect(output).toMatch(/\d+ tests across \d+ suites/);
  });

  it('returns placeholder for empty leaderboard', () => {
    const lb = buildLeaderboard([]);
    expect(formatLeaderboardMarkdown(lb)).toContain('No leaderboard entries.');
  });
});

describe('formatLeaderboardHtml', () => {
  function makeLb(): Leaderboard {
    return buildLeaderboard([
      makeRun('gpt-4', [{ name: 't1', pass: true, score: 0.95, latencyMs: 200, costUsd: 0.01 }]),
      makeRun('claude-3', [{ name: 't1', pass: true, score: 0.80, latencyMs: 150 }]),
      makeRun('gemini-pro', [{ name: 't1', pass: true, score: 0.70, latencyMs: 100 }]),
    ]);
  }

  it('produces valid HTML structure', () => {
    const output = formatLeaderboardHtml(makeLb());
    expect(output).toContain('<!DOCTYPE html>');
    expect(output).toContain('<html');
    expect(output).toContain('</html>');
    expect(output).toContain('<table');
    expect(output).toContain('</table>');
  });

  it('includes dark theme styles', () => {
    const output = formatLeaderboardHtml(makeLb());
    expect(output).toContain('--bg: #0f172a');
    expect(output).toContain('--surface: #1e293b');
  });

  it('includes sortable column script', () => {
    const output = formatLeaderboardHtml(makeLb());
    expect(output).toContain('data-sort=');
    expect(output).toContain('addEventListener');
    expect(output).toContain('sorted-asc');
  });

  it('includes bar chart section', () => {
    const output = formatLeaderboardHtml(makeLb());
    expect(output).toContain('Score Comparison');
    expect(output).toContain('bar-chart');
    expect(output).toContain('bar-rect');
  });

  it('includes model names and scores', () => {
    const output = formatLeaderboardHtml(makeLb());
    expect(output).toContain('gpt-4');
    expect(output).toContain('claude-3');
    expect(output).toContain('gemini-pro');
    expect(output).toContain('0.950');
  });

  it('includes badge icons for top 3', () => {
    const output = formatLeaderboardHtml(makeLb());
    expect(output).toContain('&#x1F947;');
    expect(output).toContain('&#x1F948;');
    expect(output).toContain('&#x1F949;');
  });

  it('includes footer with project link', () => {
    const output = formatLeaderboardHtml(makeLb());
    expect(output).toContain('cursor-plugin-evals');
    expect(output).toContain('github.com');
  });

  it('returns minimal HTML for empty leaderboard', () => {
    const lb = buildLeaderboard([]);
    const output = formatLeaderboardHtml(lb);
    expect(output).toContain('No leaderboard entries.');
    expect(output).toContain('<!DOCTYPE html>');
  });
});
