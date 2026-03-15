import { describe, it, expect } from 'vitest';
import { ResponseQualityEvaluator } from './response-quality.js';
import type { EvaluatorContext } from '../core/types.js';

const makeCtx = (overrides: Partial<EvaluatorContext> = {}): EvaluatorContext => ({
  testName: 'response-quality-test',
  toolCalls: [],
  ...overrides,
});

describe('ResponseQualityEvaluator', () => {
  const evaluator = new ResponseQualityEvaluator();

  it('has correct name', () => {
    expect(evaluator.name).toBe('response-quality');
  });

  // --- Skip when no assertions ---

  it('skips when expected is undefined', async () => {
    const result = await evaluator.evaluate(makeCtx());
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('skip');
  });

  it('skips when both contains and notContains are empty', async () => {
    const result = await evaluator.evaluate(
      makeCtx({ expected: { responseContains: [], responseNotContains: [] } }),
    );
    expect(result.score).toBe(1.0);
    expect(result.label).toBe('skip');
  });

  it('skips when expected has no response assertions', async () => {
    const result = await evaluator.evaluate(makeCtx({ expected: {} }));
    expect(result.score).toBe(1.0);
    expect(result.label).toBe('skip');
  });

  // --- response_contains ---

  it('passes when all response_contains patterns found', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'The quick brown fox jumps over the lazy dog',
        expected: { responseContains: ['quick', 'fox', 'dog'] },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('fails when a response_contains pattern is missing', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'The quick brown fox',
        expected: { responseContains: ['quick', 'cat'] },
      }),
    );
    expect(result.score).toBe(0.5);
    expect(result.explanation).toContain('contains("cat")');
  });

  it('fails when all response_contains patterns are missing', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'nothing matches',
        expected: { responseContains: ['alpha', 'beta'] },
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
  });

  // --- Case-insensitive matching ---

  it('matches response_contains case-insensitively', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'Hello WORLD',
        expected: { responseContains: ['hello', 'world'] },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('matches response_not_contains case-insensitively', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'Hello WORLD',
        expected: { responseNotContains: ['hello'] },
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
  });

  // --- response_not_contains ---

  it('passes when response_not_contains patterns are absent', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'safe content here',
        expected: { responseNotContains: ['dangerous', 'error'] },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('fails when response_not_contains pattern is present', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'this has an error in it',
        expected: { responseNotContains: ['error'] },
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toContain('not_contains("error")');
  });

  // --- Both contains and not_contains ---

  it('checks both contains and not_contains together', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'success: operation completed',
        expected: {
          responseContains: ['success'],
          responseNotContains: ['error'],
        },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('partial pass with mixed contains and not_contains results', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'error: something went wrong',
        expected: {
          responseContains: ['error'],
          responseNotContains: ['error'],
        },
      }),
    );
    expect(result.score).toBe(0.5);
  });

  it('scores proportionally across all checks', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'alpha beta',
        expected: {
          responseContains: ['alpha', 'beta', 'gamma'],
          responseNotContains: ['delta'],
        },
      }),
    );
    expect(result.score).toBe(0.75);
  });

  // --- No finalOutput ---

  it('fails all contains checks when finalOutput is empty string', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: '',
        expected: { responseContains: ['something'] },
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
  });

  it('fails all contains checks when finalOutput is undefined', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        expected: { responseContains: ['something'] },
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
  });

  it('passes not_contains when finalOutput is empty', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: '',
        expected: { responseNotContains: ['anything'] },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  // --- Threshold configuration ---

  it('uses default threshold of 0.7', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'a b',
        expected: { responseContains: ['a', 'b', 'c'] },
      }),
    );
    expect(result.score).toBeCloseTo(0.667, 2);
    expect(result.pass).toBe(false);
    expect((result.metadata as Record<string, unknown>)?.threshold).toBe(0.7);
  });

  it('passes with custom low threshold', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'a b',
        expected: { responseContains: ['a', 'b', 'c'] },
        config: { threshold: 0.5 },
      }),
    );
    expect(result.pass).toBe(true);
  });

  it('fails with custom high threshold', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'a b c',
        expected: { responseContains: ['a', 'b', 'c', 'd'] },
        config: { threshold: 0.9 },
      }),
    );
    expect(result.score).toBe(0.75);
    expect(result.pass).toBe(false);
  });

  // --- Metadata structure ---

  it('includes detailed metadata', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'hello world',
        expected: {
          responseContains: ['hello'],
          responseNotContains: ['error'],
        },
      }),
    );
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.totalChecks).toBe(2);
    expect(meta.passed).toBe(2);
    expect(meta.threshold).toBe(0.7);
    const results = meta.results as Array<{ pattern: string; type: string; pass: boolean }>;
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ pattern: 'hello', type: 'contains', pass: true });
    expect(results[1]).toEqual({ pattern: 'error', type: 'not_contains', pass: true });
  });

  // --- Score rounding ---

  it('rounds score to 3 decimal places', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        finalOutput: 'a',
        expected: { responseContains: ['a', 'b', 'c'] },
      }),
    );
    expect(result.score).toBe(0.333);
  });
});
