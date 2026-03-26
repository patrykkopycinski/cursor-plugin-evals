import { describe, it, expect } from 'vitest';
import { ScriptEvaluator } from './script.js';
import type { EvaluatorContext } from '../core/types.js';

function makeContext(overrides: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    testName: 'test-script',
    prompt: 'Summarize the output',
    toolCalls: [],
    finalOutput: 'The output is good',
    ...overrides,
  };
}

describe('ScriptEvaluator', () => {
  const evaluator = new ScriptEvaluator();

  it('has correct name and kind', () => {
    expect(evaluator.name).toBe('script');
    expect(evaluator.kind).toBe('CODE');
  });

  it('returns error when no run command is specified', async () => {
    const result = await evaluator.evaluate(makeContext({ config: {} }));
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toMatch(/no run command/i);
  });

  it('runs shell command and parses JSON score', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: `echo '{"score": 0.9, "label": "good", "explanation": "looks great"}'`,
        },
      }),
    );
    expect(result.score).toBe(0.9);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('good');
    expect(result.explanation).toBe('looks great');
  });

  it('passes finalOutput as EVAL_OUTPUT env var', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        finalOutput: 'hello world',
        config: {
          run: `echo "{\\"score\\": 1, \\"explanation\\": \\"$EVAL_OUTPUT\\"}"`,
        },
      }),
    );
    expect(result.score).toBe(1);
    expect(result.explanation).toBe('hello world');
  });

  it('passes prompt as EVAL_PROMPT env var', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        prompt: 'my-prompt',
        config: {
          run: `echo "{\\"score\\": 1, \\"explanation\\": \\"$EVAL_PROMPT\\"}"`,
        },
      }),
    );
    expect(result.score).toBe(1);
    expect(result.explanation).toBe('my-prompt');
  });

  it('passes testName as EVAL_TEST_NAME env var', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        testName: 'my-test',
        config: {
          run: `echo "{\\"score\\": 1, \\"explanation\\": \\"$EVAL_TEST_NAME\\"}"`,
        },
      }),
    );
    expect(result.score).toBe(1);
    expect(result.explanation).toBe('my-test');
  });

  it('defaults to threshold 0.5 — score 0.6 passes', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: `echo '{"score": 0.6}'`,
        },
      }),
    );
    expect(result.pass).toBe(true);
  });

  it('defaults to threshold 0.5 — score 0.4 fails', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: `echo '{"score": 0.4}'`,
        },
      }),
    );
    expect(result.pass).toBe(false);
  });

  it('respects custom threshold', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: `echo '{"score": 0.7}'`,
          threshold: 0.8,
        },
      }),
    );
    expect(result.score).toBe(0.7);
    expect(result.pass).toBe(false);
  });

  it('clamps score above 1 to 1', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: `echo '{"score": 1.5}'`,
        },
      }),
    );
    expect(result.score).toBe(1);
  });

  it('clamps score below 0 to 0', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: `echo '{"score": -0.3}'`,
        },
      }),
    );
    expect(result.score).toBe(0);
  });

  it('returns score=0 pass=false when script exits non-zero', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: `exit 1`,
        },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toBeTruthy();
  });

  it('returns score=0 pass=false when script outputs invalid JSON', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: `echo 'not json at all'`,
        },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toMatch(/parse/i);
  });

  it('extracts JSON embedded in other output', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        config: {
          run: `echo 'some prefix {"score": 0.8} some suffix'`,
        },
      }),
    );
    expect(result.score).toBe(0.8);
    expect(result.pass).toBe(true);
  });
});
