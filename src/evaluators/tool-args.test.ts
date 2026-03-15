import { describe, it, expect } from 'vitest';
import { ToolArgsEvaluator } from './tool-args.js';
import type { EvaluatorContext, ToolCallRecord } from '../core/types.js';

const makeCall = (
  tool: string,
  args: Record<string, unknown> = {},
): ToolCallRecord => ({
  tool,
  args,
  result: { content: [{ type: 'text', text: 'ok' }] },
  latencyMs: 50,
});

const makeCtx = (overrides: Partial<EvaluatorContext> = {}): EvaluatorContext => ({
  testName: 'tool-args-test',
  toolCalls: [],
  ...overrides,
});

describe('ToolArgsEvaluator', () => {
  const evaluator = new ToolArgsEvaluator();

  it('has correct name', () => {
    expect(evaluator.name).toBe('tool-args');
  });

  // --- Skip when no expected args ---

  it('skips when expectedToolArgs is undefined', async () => {
    const result = await evaluator.evaluate(makeCtx({ expected: {} }));
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('skip');
  });

  it('skips when expectedToolArgs is empty object', async () => {
    const result = await evaluator.evaluate(
      makeCtx({ expected: { toolArgs: {} } }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('skip');
  });

  // --- Exact value matching ---

  it('matches exact string value', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('search', { query: 'hello world' })],
        expected: { toolArgs: { search: { query: 'hello world' } } },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('matches exact number value', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('paginate', { limit: 10 })],
        expected: { toolArgs: { paginate: { limit: 10 } } },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('matches exact boolean value', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('toggle', { enabled: true })],
        expected: { toolArgs: { toggle: { enabled: true } } },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('matches exact object value via deepEqual', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall('create', { config: { nested: { key: 'val' } } }),
        ],
        expected: {
          toolArgs: { create: { config: { nested: { key: 'val' } } } },
        },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('matches exact array value via deepEqual', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('batch', { ids: [1, 2, 3] })],
        expected: { toolArgs: { batch: { ids: [1, 2, 3] } } },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  // --- Case-insensitive substring matching for strings ---

  it('matches case-insensitive substring for strings', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('search', { query: 'Hello World Example' })],
        expected: { toolArgs: { search: { query: 'hello world' } } },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('matches when expected is substring of actual (case-insensitive)', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall('search', { query: 'The QUICK brown FOX jumps' }),
        ],
        expected: { toolArgs: { search: { query: 'quick brown fox' } } },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  // --- deepEqual edge cases ---

  it('fails when nested object has different value', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('create', { config: { key: 'wrong' } })],
        expected: { toolArgs: { create: { config: { key: 'right' } } } },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
  });

  it('fails when array lengths differ', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('batch', { ids: [1, 2] })],
        expected: { toolArgs: { batch: { ids: [1, 2, 3] } } },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
  });

  it('fails when object has extra keys vs expected', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('create', { config: { a: 1, b: 2 } })],
        expected: { toolArgs: { create: { config: { a: 1 } } } },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
  });

  it('fails when object is missing keys vs expected', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('create', { config: { a: 1 } })],
        expected: { toolArgs: { create: { config: { a: 1, b: 2 } } } },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
  });

  it('deepEqual treats null and undefined differently', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('create', { config: null })],
        expected: { toolArgs: { create: { config: undefined } } },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
  });

  // --- Tool not found ---

  it('fails when tool is not present in toolCalls', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('other_tool', { x: 1 })],
        expected: { toolArgs: { missing_tool: { x: 1 } } },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toContain('missing_tool.x');
  });

  it('reports actual as undefined when tool not found', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [],
        expected: { toolArgs: { absent: { arg: 'value' } } },
      }),
    );
    const details = (result.metadata as Record<string, unknown>)?.details as Array<{
      actual: unknown;
    }>;
    expect(details[0].actual).toBeUndefined();
  });

  // --- Multiple tools with args ---

  it('checks args across different tools', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall('tool_a', { x: 10 }),
          makeCall('tool_b', { y: 'hello' }),
        ],
        expected: {
          toolArgs: {
            tool_a: { x: 10 },
            tool_b: { y: 'hello' },
          },
        },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('partial match across multiple tools scores proportionally', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall('tool_a', { x: 10 }),
          makeCall('tool_b', { y: 'wrong' }),
        ],
        expected: {
          toolArgs: {
            tool_a: { x: 10 },
            tool_b: { y: 'expected' },
          },
        },
      }),
    );
    expect(result.score).toBe(0.5);
  });

  // --- Multiple calls to same tool (best match) ---

  it('finds best match across multiple calls to the same tool', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall('search', { query: 'irrelevant' }),
          makeCall('search', { query: 'the correct query value' }),
        ],
        expected: { toolArgs: { search: { query: 'correct query' } } },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('uses first call value for detail when no match across multiple calls', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall('search', { query: 'first' }),
          makeCall('search', { query: 'second' }),
        ],
        expected: { toolArgs: { search: { query: 'not present at all' } } },
      }),
    );
    expect(result.score).toBe(0);
    const details = (result.metadata as Record<string, unknown>)?.details as Array<{
      actual: unknown;
    }>;
    expect(details[0].actual).toBe('first');
  });

  // --- Case-insensitive tool name matching ---

  it('matches tool names case-insensitively', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('MyTool', { x: 1 })],
        expected: { toolArgs: { mytool: { x: 1 } } },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  // --- Threshold configuration ---

  it('uses default threshold of 0.7', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('t', { a: 1, b: 2, c: 3 })],
        expected: { toolArgs: { t: { a: 1, b: 999, c: 999 } } },
      }),
    );
    expect(result.score).toBeCloseTo(0.333, 2);
    expect(result.pass).toBe(false);
    expect((result.metadata as Record<string, unknown>)?.threshold).toBe(0.7);
  });

  it('passes with custom low threshold', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('t', { a: 1, b: 999 })],
        expected: { toolArgs: { t: { a: 1, b: 2 } } },
        config: { threshold: 0.4 },
      }),
    );
    expect(result.score).toBe(0.5);
    expect(result.pass).toBe(true);
  });

  it('fails with custom high threshold', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('t', { a: 1, b: 999 })],
        expected: { toolArgs: { t: { a: 1, b: 2 } } },
        config: { threshold: 0.9 },
      }),
    );
    expect(result.score).toBe(0.5);
    expect(result.pass).toBe(false);
  });

  // --- Score rounding ---

  it('rounds score to 3 decimal places', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('t', { a: 1, b: 2, c: 3 })],
        expected: { toolArgs: { t: { a: 1, b: 999, c: 999 } } },
      }),
    );
    expect(result.score).toBe(0.333);
  });

  // --- Metadata structure ---

  it('includes detailed metadata in result', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('search', { query: 'hello' })],
        expected: { toolArgs: { search: { query: 'hello' } } },
      }),
    );
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.totalExpected).toBe(1);
    expect(meta.totalMatched).toBe(1);
    expect(meta.threshold).toBe(0.7);
    expect(meta.details).toHaveLength(1);
  });
});
