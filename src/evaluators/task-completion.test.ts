import { describe, it, expect, vi } from 'vitest';
import { TaskCompletionEvaluator } from './task-completion.js';
import type { EvaluatorContext } from '../core/types.js';

vi.mock('./llm-judge.js', () => ({
  callJudge: vi.fn(),
}));

import { callJudge } from './llm-judge.js';

const mockedCallJudge = vi.mocked(callJudge);

function makeContext(overrides: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    testName: 'test',
    toolCalls: [],
    ...overrides,
  };
}

describe('TaskCompletionEvaluator', () => {
  const evaluator = new TaskCompletionEvaluator();

  it('has correct name and kind', () => {
    expect(evaluator.name).toBe('task-completion');
    expect(evaluator.kind).toBe('LLM');
  });

  it('returns 1.0 for fully achieved goal', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 1.0,
      label: 'FULLY_ACHIEVED',
      explanation: 'The index was created as requested.',
    });

    const result = await evaluator.evaluate(
      makeContext({
        prompt: 'Create an Elasticsearch index called test-index',
        toolCalls: [
          {
            tool: 'elasticsearch_api',
            args: { method: 'PUT', path: '/test-index' },
            result: { content: [{ type: 'text', text: '{"acknowledged":true}' }] },
            latencyMs: 50,
          },
        ],
        finalOutput: 'Successfully created the test-index.',
      }),
    );

    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('FULLY_ACHIEVED');
  });

  it('returns 0.5 for partially achieved goal', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 0.5,
      label: 'PARTIALLY_ACHIEVED',
      explanation: 'Index created but mapping was not configured.',
    });

    const result = await evaluator.evaluate(
      makeContext({
        prompt: 'Create an index with custom mapping for logs',
        toolCalls: [
          {
            tool: 'elasticsearch_api',
            args: { method: 'PUT', path: '/logs-index' },
            result: { content: [{ type: 'text', text: '{"acknowledged":true}' }] },
            latencyMs: 50,
          },
        ],
        finalOutput: 'Created the index.',
      }),
    );

    expect(result.score).toBe(0.5);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('PARTIALLY_ACHIEVED');
  });

  it('returns 0.0 for not achieved goal', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 0.0,
      label: 'NOT_ACHIEVED',
      explanation: 'The agent did not accomplish the task.',
    });

    const result = await evaluator.evaluate(
      makeContext({
        prompt: 'Delete all old indices',
        toolCalls: [],
        finalOutput: 'I cannot help with that.',
      }),
    );

    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
    expect(result.label).toBe('NOT_ACHIEVED');
  });

  it('uses custom threshold from config', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 0.5,
      label: 'PARTIALLY_ACHIEVED',
      explanation: 'Partial success.',
    });

    const failResult = await evaluator.evaluate(
      makeContext({
        prompt: 'task',
        config: { 'task-completion': 0.8 },
      }),
    );
    expect(failResult.pass).toBe(false);

    mockedCallJudge.mockResolvedValueOnce({
      score: 0.5,
      label: 'PARTIALLY_ACHIEVED',
      explanation: 'Partial success.',
    });

    const passResult = await evaluator.evaluate(
      makeContext({
        prompt: 'task',
        config: { 'task-completion': 0.3 },
      }),
    );
    expect(passResult.pass).toBe(true);
  });

  it('handles judge failure gracefully', async () => {
    mockedCallJudge.mockRejectedValueOnce(new Error('Rate limited'));

    const result = await evaluator.evaluate(makeContext({ prompt: 'test' }));

    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.label).toBe('error');
    expect(result.explanation).toContain('Rate limited');
  });

  it('includes expected output in the judge prompt', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 1.0,
      label: 'FULLY_ACHIEVED',
      explanation: 'Done',
    });

    await evaluator.evaluate(
      makeContext({
        prompt: 'List indices',
        expected: { tools: ['elasticsearch_api'], responseContains: ['indices'] },
        finalOutput: 'Here are the indices: ...',
      }),
    );

    expect(mockedCallJudge).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('Expected output hints'),
      }),
    );
  });

  it('handles context with no expected output', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 1.0,
      label: 'FULLY_ACHIEVED',
      explanation: 'Done',
    });

    const result = await evaluator.evaluate(
      makeContext({ prompt: 'Do something', finalOutput: 'Done' }),
    );

    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });
});
