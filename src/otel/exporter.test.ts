import { describe, it, expect } from 'vitest';
import { buildOtelSpans } from './exporter.js';
import type { RunResult } from '../core/types.js';

function makeRunResult(): RunResult {
  return {
    runId: 'run-123', timestamp: '2026-03-26T00:00:00Z', config: 'test.yaml',
    suites: [{
      name: 'test-suite', layer: 'llm',
      tests: [{
        name: 'test-1', suite: 'test-suite', layer: 'llm', pass: true,
        toolCalls: [{ tool: 'search', args: { q: 'hello' }, result: { content: [{ type: 'text', text: 'found' }] }, latencyMs: 50 }],
        evaluatorResults: [{ evaluator: 'correctness', score: 0.9, pass: true, label: 'CORRECT' }],
        latencyMs: 200,
      }],
      passRate: 1.0, duration: 200, evaluatorSummary: {},
    }],
    overall: { total: 1, passed: 1, failed: 0, skipped: 0, passRate: 1.0, duration: 200 },
  };
}

describe('buildOtelSpans', () => {
  it('creates a root span for the run', () => {
    const spans = buildOtelSpans(makeRunResult());
    const root = spans.find(s => s.name === 'eval-run');
    expect(root).toBeDefined();
    expect(root!.attributes['eval.run_id']).toBe('run-123');
    expect(root!.attributes['eval.pass_rate']).toBe(1.0);
  });

  it('creates child spans for each test', () => {
    const spans = buildOtelSpans(makeRunResult());
    const testSpan = spans.find(s => s.name === 'eval-test:test-1');
    expect(testSpan).toBeDefined();
    expect(testSpan!.attributes['eval.test.pass']).toBe(true);
    expect(testSpan!.attributes['eval.test.latency_ms']).toBe(200);
  });

  it('creates child spans for tool calls', () => {
    const spans = buildOtelSpans(makeRunResult());
    const toolSpan = spans.find(s => s.name === 'tool:search');
    expect(toolSpan).toBeDefined();
    expect(toolSpan!.attributes['tool.latency_ms']).toBe(50);
  });

  it('includes evaluator results as span events', () => {
    const spans = buildOtelSpans(makeRunResult());
    const testSpan = spans.find(s => s.name === 'eval-test:test-1');
    expect(testSpan!.events).toHaveLength(1);
    expect(testSpan!.events![0].name).toBe('evaluator:correctness');
    expect(testSpan!.events![0].attributes!['score']).toBe(0.9);
  });

  it('returns just root for empty run', () => {
    const empty: RunResult = {
      runId: 'empty', timestamp: '', config: '',
      suites: [], overall: { total: 0, passed: 0, failed: 0, skipped: 0, passRate: 0, duration: 0 },
    };
    expect(buildOtelSpans(empty)).toHaveLength(1);
  });

  it('handles multiple suites and tests', () => {
    const run = makeRunResult();
    run.suites.push({
      name: 'suite-2', layer: 'static',
      tests: [{ name: 'test-2', suite: 'suite-2', layer: 'static', pass: false, toolCalls: [], evaluatorResults: [], latencyMs: 50 }],
      passRate: 0, duration: 50, evaluatorSummary: {},
    });
    run.overall.total = 2;
    const spans = buildOtelSpans(run);
    expect(spans.filter(s => s.name.startsWith('eval-test:'))).toHaveLength(2);
  });
});
