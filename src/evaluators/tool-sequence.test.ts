import { describe, it, expect } from 'vitest';
import { ToolSequenceEvaluator } from './tool-sequence.js';
import type { EvaluatorContext, ToolCallRecord } from '../core/types.js';

const makeCall = (tool: string): ToolCallRecord => ({
  tool,
  args: {},
  result: { content: [{ type: 'text', text: 'ok' }] },
  latencyMs: 50,
});

const makeCtx = (overrides: Partial<EvaluatorContext> = {}): EvaluatorContext => ({
  testName: 'tool-sequence-test',
  toolCalls: [],
  ...overrides,
});

describe('ToolSequenceEvaluator', () => {
  const evaluator = new ToolSequenceEvaluator();

  it('has correct name', () => {
    expect(evaluator.name).toBe('tool-sequence');
  });

  // --- Skip when no expected sequence ---

  it('skips when toolSequence is undefined', async () => {
    const result = await evaluator.evaluate(makeCtx({ expected: {} }));
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('skip');
  });

  it('skips when toolSequence is empty array', async () => {
    const result = await evaluator.evaluate(
      makeCtx({ expected: { toolSequence: [] } }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('skip');
  });

  // --- Perfect match ---

  it('scores 1.0 for exact sequence match', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a'), makeCall('b'), makeCall('c')],
        expected: { toolSequence: ['a', 'b', 'c'] },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('pass');
  });

  it('scores 1.0 when actual has extra tools but preserves full sequence', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall('a'),
          makeCall('x'),
          makeCall('b'),
          makeCall('y'),
          makeCall('c'),
        ],
        expected: { toolSequence: ['a', 'b', 'c'] },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  // --- No overlap ---

  it('scores 0.0 when no tools match', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('x'), makeCall('y'), makeCall('z')],
        expected: { toolSequence: ['a', 'b', 'c'] },
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
    expect(result.label).toBe('fail');
  });

  // --- Partial subsequence ---

  it('scores partial match for subsequence', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a'), makeCall('c')],
        expected: { toolSequence: ['a', 'b', 'c'] },
      }),
    );
    expect(result.score).toBeCloseTo(0.667, 2);
    expect(result.pass).toBe(false);
  });

  it('scores 0.5 when half the sequence matches', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a'), makeCall('b')],
        expected: { toolSequence: ['a', 'b', 'c', 'd'] },
      }),
    );
    expect(result.score).toBe(0.5);
  });

  // --- Empty actual tool calls ---

  it('scores 0.0 when no actual tool calls', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [],
        expected: { toolSequence: ['a', 'b'] },
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
  });

  // --- Threshold configuration ---

  it('uses default threshold of 0.8', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a'), makeCall('b')],
        expected: { toolSequence: ['a', 'b', 'c'] },
      }),
    );
    expect(result.score).toBeCloseTo(0.667, 2);
    expect(result.pass).toBe(false);
    expect((result.metadata as Record<string, unknown>)?.threshold).toBe(0.8);
  });

  it('passes with custom low threshold', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a'), makeCall('b')],
        expected: { toolSequence: ['a', 'b', 'c'] },
        config: { threshold: 0.5 },
      }),
    );
    expect(result.score).toBeCloseTo(0.667, 2);
    expect(result.pass).toBe(true);
  });

  it('fails with custom high threshold', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a'), makeCall('b'), makeCall('c')],
        expected: { toolSequence: ['a', 'b', 'c'] },
        config: { threshold: 1.0 },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  // --- Duplicate tool names in sequence ---

  it('handles duplicate tool names in expected sequence', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a'), makeCall('b'), makeCall('a')],
        expected: { toolSequence: ['a', 'b', 'a'] },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('handles partial match with duplicates', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a'), makeCall('b')],
        expected: { toolSequence: ['a', 'b', 'a'] },
      }),
    );
    expect(result.score).toBeCloseTo(0.667, 2);
  });

  // --- Order matters (LCS-based) ---

  it('scores lower when sequence is reversed', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('c'), makeCall('b'), makeCall('a')],
        expected: { toolSequence: ['a', 'b', 'c'] },
      }),
    );
    expect(result.score).toBeCloseTo(0.333, 2);
  });

  // --- Score rounding ---

  it('rounds score to 3 decimal places', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a')],
        expected: { toolSequence: ['a', 'b', 'c'] },
      }),
    );
    expect(result.score).toBe(0.333);
  });

  // --- Metadata structure ---

  it('includes expected and actual sequences in metadata', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a'), makeCall('b')],
        expected: { toolSequence: ['a', 'b', 'c'] },
      }),
    );
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.expectedSequence).toEqual(['a', 'b', 'c']);
    expect(meta.actualSequence).toEqual(['a', 'b']);
    expect(meta.expectedLength).toBe(3);
    expect(meta.actualLength).toBe(2);
    expect(meta.lcsLength).toBe(2);
    expect(meta.threshold).toBe(0.8);
  });

  it('includes LCS info in explanation', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall('a'), makeCall('c')],
        expected: { toolSequence: ['a', 'b', 'c'] },
      }),
    );
    expect(result.explanation).toContain('LCS length=2/3');
    expect(result.explanation).toContain('Expected:');
    expect(result.explanation).toContain('Actual:');
  });
});
