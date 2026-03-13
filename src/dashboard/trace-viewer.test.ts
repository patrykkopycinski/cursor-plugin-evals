import { describe, it, expect } from 'vitest';
import { extractTraceViewData } from './trace-viewer.js';
import { renderTraceHtml } from './trace-page.js';
import type { TestResult } from '../core/types.js';

function makeTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    name: 'test-search',
    suite: 'elastic-tools',
    layer: 'llm',
    pass: true,
    toolCalls: [
      {
        tool: 'elasticsearch_api',
        args: { method: 'GET', path: '/_cat/indices' },
        result: { content: [{ type: 'text', text: 'green open .kibana' }] },
        latencyMs: 42,
      },
    ],
    evaluatorResults: [
      {
        evaluator: 'tool-selection',
        score: 1.0,
        pass: true,
        explanation: 'Correct tool selected',
      },
      {
        evaluator: 'response-quality',
        score: 0.6,
        pass: false,
        explanation: 'Response lacks detail',
      },
    ],
    tokenUsage: { input: 1200, output: 350 },
    latencyMs: 2500,
    model: 'gpt-4o',
    ...overrides,
  };
}

describe('extractTraceViewData', () => {
  it('extracts basic fields from test result', () => {
    const data = extractTraceViewData(makeTestResult(), 'run-abc');

    expect(data.runId).toBe('run-abc');
    expect(data.testName).toBe('test-search');
    expect(data.suiteName).toBe('elastic-tools');
    expect(data.model).toBe('gpt-4o');
    expect(data.totalLatencyMs).toBe(2500);
  });

  it('maps evaluator results correctly', () => {
    const data = extractTraceViewData(makeTestResult(), 'run-1');

    expect(data.evaluatorResults).toHaveLength(2);
    expect(data.evaluatorResults[0]).toEqual({
      name: 'tool-selection',
      score: 1.0,
      pass: true,
      explanation: 'Correct tool selected',
    });
    expect(data.evaluatorResults[1].pass).toBe(false);
  });

  it('extracts token usage', () => {
    const data = extractTraceViewData(makeTestResult(), 'run-1');
    expect(data.tokenUsage).toEqual({ input: 1200, output: 350 });
  });

  it('handles missing token usage', () => {
    const data = extractTraceViewData(makeTestResult({ tokenUsage: undefined }), 'run-1');
    expect(data.tokenUsage).toBeUndefined();
  });

  it('creates turns from tool calls when no messages in metadata', () => {
    const data = extractTraceViewData(makeTestResult(), 'run-1');
    expect(data.turns.length).toBeGreaterThanOrEqual(1);

    const toolTurn = data.turns.find((t) => t.role === 'tool');
    expect(toolTurn).toBeDefined();
    expect(toolTurn!.toolCalls).toHaveLength(1);
    expect(toolTurn!.toolCalls![0].tool).toBe('elasticsearch_api');
  });

  it('uses messages from metadata when available', () => {
    const data = extractTraceViewData(
      makeTestResult({
        metadata: {
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'List indices' },
            { role: 'assistant', content: 'Here are the indices...' },
          ],
        },
      }),
      'run-1',
    );

    expect(data.turns).toHaveLength(3);
    expect(data.turns[0].role).toBe('system');
    expect(data.turns[1].role).toBe('user');
    expect(data.turns[2].role).toBe('assistant');
  });
});

describe('renderTraceHtml', () => {
  it('produces valid HTML with required sections', () => {
    const data = extractTraceViewData(makeTestResult(), 'run-abc');
    const html = renderTraceHtml(data);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('test-search');
    expect(html).toContain('elastic-tools');
    expect(html).toContain('gpt-4o');
    expect(html).toContain('Timeline');
    expect(html).toContain('Evaluators');
    expect(html).toContain('Token Usage');
  });

  it('includes evaluator badges with scores', () => {
    const data = extractTraceViewData(makeTestResult(), 'run-1');
    const html = renderTraceHtml(data);

    expect(html).toContain('tool-selection');
    expect(html).toContain('100%');
    expect(html).toContain('response-quality');
    expect(html).toContain('60%');
  });

  it('renders pass/fail classes on evaluator badges', () => {
    const data = extractTraceViewData(makeTestResult(), 'run-1');
    const html = renderTraceHtml(data);

    expect(html).toContain('class="eval-badge pass"');
    expect(html).toContain('class="eval-badge fail"');
  });

  it('supports dark theme via prefers-color-scheme', () => {
    const data = extractTraceViewData(makeTestResult(), 'run-1');
    const html = renderTraceHtml(data);

    expect(html).toContain('prefers-color-scheme: light');
  });

  it('omits token usage section when not available', () => {
    const data = extractTraceViewData(makeTestResult({ tokenUsage: undefined }), 'run-1');
    const html = renderTraceHtml(data);

    expect(html).not.toContain('Token Usage');
  });

  it('renders tool call details', () => {
    const data = extractTraceViewData(makeTestResult(), 'run-1');
    const html = renderTraceHtml(data);

    expect(html).toContain('elasticsearch_api');
    expect(html).toContain('42ms');
  });
});
