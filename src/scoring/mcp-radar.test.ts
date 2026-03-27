import { describe, it, expect } from 'vitest';
import { computeMcpRadarReport, type McpRadarReport } from './mcp-radar.js';
import type { TestResult } from '../core/types.js';

function makeTest(name: string, tools: string[], expectedTools: string[], opts?: { tokenInput?: number; latencyMs?: number }): TestResult {
  const toolCalls = tools.map(t => ({ tool: t, args: {}, result: { content: [{ type: 'text', text: 'ok' }] }, latencyMs: 50 }));
  const selScore = expectedTools.length > 0 ? tools.filter(t => expectedTools.includes(t)).length / Math.max(tools.length, expectedTools.length) : 1;
  return {
    name, suite: 's', layer: 'llm', pass: selScore >= 0.5, toolCalls,
    evaluatorResults: [
      { evaluator: 'tool-selection', score: selScore, pass: selScore >= 0.5, metadata: { expected: expectedTools, selected: tools } },
      { evaluator: 'tool-args', score: 0.9, pass: true },
    ],
    latencyMs: opts?.latencyMs ?? 200,
    tokenUsage: { input: opts?.tokenInput ?? 500, output: 200 },
  };
}

describe('computeMcpRadarReport', () => {
  it('computes per-tool precision/recall/F1', () => {
    const tests = [
      makeTest('t1', ['search', 'query'], ['search', 'query']),
      makeTest('t2', ['search'], ['search', 'index']),
    ];
    const report = computeMcpRadarReport(tests);
    const searchMetrics = report.perToolMetrics.find(m => m.tool === 'search');
    expect(searchMetrics).toBeDefined();
    expect(searchMetrics!.precision).toBe(1); // search was always correct
    expect(searchMetrics!.recall).toBe(1);    // search was always selected when expected
  });

  it('computes tool hit rate', () => {
    const tests = [
      makeTest('t1', ['search'], ['search']),
      makeTest('t2', ['wrong'], ['search']),
    ];
    const report = computeMcpRadarReport(tests);
    expect(report.toolHitRate).toBe(0.5); // 1 of 2 hit
  });

  it('computes MRR', () => {
    const tests = [
      makeTest('t1', ['search', 'query'], ['search']), // rank 1 → RR=1
      makeTest('t2', ['query', 'search'], ['search']),  // rank 2 → RR=0.5
    ];
    const report = computeMcpRadarReport(tests);
    expect(report.meanReciprocalRank).toBeCloseTo(0.75); // (1 + 0.5) / 2
  });

  it('computes token waste ratio', () => {
    const tests = [makeTest('t1', ['search'], ['search'], { tokenInput: 2000 })];
    const report = computeMcpRadarReport(tests);
    expect(typeof report.tokenWasteRatio).toBe('number');
    expect(report.tokenWasteRatio).toBeGreaterThanOrEqual(0);
    expect(report.tokenWasteRatio).toBeLessThanOrEqual(1);
  });

  it('computes execution speed metrics', () => {
    const tests = [makeTest('t1', ['a', 'b'], ['a', 'b'], { latencyMs: 300 })];
    const report = computeMcpRadarReport(tests);
    expect(report.avgTimeToFirstToolMs).toBe(50); // first tool latency
    expect(report.avgToolExecutionMs).toBe(50);    // all tools have 50ms
    expect(report.totalExecutionMs).toBe(300);
  });

  it('handles empty test list', () => {
    const report = computeMcpRadarReport([]);
    expect(report.toolHitRate).toBe(0);
    expect(report.perToolMetrics).toHaveLength(0);
    expect(report.meanReciprocalRank).toBe(0);
  });

  it('handles tests without tool evaluators', () => {
    const test: TestResult = {
      name: 'no-eval', suite: 's', layer: 'llm', pass: true,
      toolCalls: [{ tool: 'search', args: {}, result: { content: [{ type: 'text', text: 'ok' }] }, latencyMs: 50 }],
      evaluatorResults: [], latencyMs: 100,
    };
    const report = computeMcpRadarReport([test]);
    expect(report.toolHitRate).toBe(0); // no tool-selection evaluator
  });
});
