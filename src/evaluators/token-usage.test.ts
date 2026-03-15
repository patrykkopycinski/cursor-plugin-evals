import { describe, it, expect } from 'vitest';
import { TokenUsageEvaluator } from './token-usage.js';
import type { ToolCallRecord } from '../core/types.js';

const evaluator = new TokenUsageEvaluator();

const makeCall = (tool: string, resultText = 'ok'): ToolCallRecord => ({
  tool,
  args: {},
  result: { content: [{ type: 'text', text: resultText }] },
  latencyMs: 50,
});

describe('TokenUsageEvaluator', () => {
  it('passes under budget with efficiency score', async () => {
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      config: { 'token-usage': { max_total: 1000 } },
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.label).toBe('efficient');
  });

  it('passes at budget boundary', async () => {
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [],
      tokenUsage: { input: 500, output: 500 },
      config: { 'token-usage': { max_total: 1000 } },
    });
    expect(result.pass).toBe(true);
    expect(result.label).toBe('near_limit');
  });

  it('fails when over budget', async () => {
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [],
      tokenUsage: { input: 600, output: 600 },
      config: { 'token-usage': { max_total: 1000 } },
    });
    expect(result.pass).toBe(false);
    expect(result.label).toBe('over_budget');
    expect(result.score).toBeLessThan(1);
    expect(result.score).toBeGreaterThan(0);
  });

  it('scores near 0 when way over budget (200%)', async () => {
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [],
      tokenUsage: { input: 1000, output: 1000 },
      config: { 'token-usage': { max_total: 1000 } },
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });

  it('skips when no token usage data is available', async () => {
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [],
    });
    expect(result.skipped).toBe(true);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('no_data');
  });

  it('estimates input tokens from text when adapter does not report them', async () => {
    const result = await evaluator.evaluate({
      testName: 'test',
      prompt: 'a'.repeat(400),
      toolCalls: [makeCall('tool_a', 'b'.repeat(400))],
      tokenUsage: { input: 0, output: 100 },
      adapterCapabilities: {
        hasToolCalls: true,
        hasFileAccess: false,
        hasWorkspaceIsolation: false,
        reportsInputTokens: false,
      },
      config: { 'token-usage': { max_total: 5000 } },
    });
    expect(result.pass).toBe(true);
    const metadata = result.metadata as { input: number; inputEstimated: boolean };
    expect(metadata.inputEstimated).toBe(true);
    expect(metadata.input).toBe(Math.ceil(800 / 4));
  });

  it('supports custom budget configuration for individual limits', async () => {
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [],
      tokenUsage: { input: 600, output: 50 },
      config: {
        'token-usage': { max_input: 500, max_output: 200, max_total: 2000 },
      },
    });
    expect(result.pass).toBe(false);
    expect(result.label).toBe('over_budget');
    expect(result.explanation).toContain('input 600 > max 500');
  });

  it('supports shorthand number config for max_total', async () => {
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      config: { 'token-usage': 500 },
    });
    expect(result.pass).toBe(true);
  });

  it('reports only when no budget is set', async () => {
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      config: {},
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
    expect(result.label).toBe('report_only');
  });

  it('handles low token count with small output', async () => {
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [],
      tokenUsage: { input: 5, output: 2 },
      config: { 'token-usage': { max_total: 1000 } },
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.label).toBe('efficient');
  });
});
