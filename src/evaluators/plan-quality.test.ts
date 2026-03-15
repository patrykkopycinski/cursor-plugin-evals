import { describe, it, expect, vi } from 'vitest';
import { PlanQualityEvaluator } from './plan-quality.js';
import type { EvaluatorContext } from '../core/types.js';

vi.mock('./llm-judge.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    callJudge: vi.fn(),
  };
});

import { callJudge } from './llm-judge.js';

const mockedCallJudge = vi.mocked(callJudge);

function makeContext(overrides: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    testName: 'test',
    toolCalls: [],
    ...overrides,
  };
}

describe('PlanQualityEvaluator', () => {
  const evaluator = new PlanQualityEvaluator();

  it('has correct name and kind', () => {
    expect(evaluator.name).toBe('plan-quality');
    expect(evaluator.kind).toBe('LLM');
  });

  it('returns passing result for excellent planning', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 0.95,
      label: 'EXCELLENT',
      explanation: 'Clear decomposition with optimal tool usage',
    });

    const result = await evaluator.evaluate(
      makeContext({
        prompt: 'Create an index and add a document',
        toolCalls: [
          {
            tool: 'elasticsearch_api',
            args: { method: 'PUT', path: '/my-index' },
            result: { content: [{ type: 'text', text: '{"acknowledged":true}' }] },
            latencyMs: 50,
          },
          {
            tool: 'elasticsearch_api',
            args: { method: 'POST', path: '/my-index/_doc', body: { title: 'test' } },
            result: { content: [{ type: 'text', text: '{"result":"created"}' }] },
            latencyMs: 30,
          },
        ],
        finalOutput: 'Index created and document added.',
      }),
    );

    expect(result.score).toBe(0.95);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('EXCELLENT');
  });

  it('returns failing result for poor planning', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 0.3,
      label: 'POOR',
      explanation: 'Wrong tools and illogical ordering',
    });

    const result = await evaluator.evaluate(
      makeContext({
        prompt: 'List all indices',
        toolCalls: [
          {
            tool: 'wrong_tool',
            args: {},
            result: { content: [{ type: 'text', text: 'error' }], isError: true },
            latencyMs: 100,
          },
        ],
      }),
    );

    expect(result.score).toBe(0.3);
    expect(result.pass).toBe(false);
    expect(result.label).toBe('POOR');
  });

  it('uses custom threshold from config', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 0.55,
      label: 'ADEQUATE',
      explanation: 'Passable plan',
    });

    const result = await evaluator.evaluate(
      makeContext({
        prompt: 'Do something',
        config: { 'plan-quality': 0.5 },
      }),
    );

    expect(result.score).toBe(0.55);
    expect(result.pass).toBe(true);
  });

  it('handles judge failure gracefully', async () => {
    mockedCallJudge.mockRejectedValueOnce(new Error('API timeout'));

    const result = await evaluator.evaluate(makeContext({ prompt: 'test' }));

    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.label).toBe('error');
    expect(result.explanation).toContain('API timeout');
  });

  it('includes tool call details in the judge prompt', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 0.8,
      label: 'GOOD',
      explanation: 'Fine',
    });

    await evaluator.evaluate(
      makeContext({
        prompt: 'Search for logs',
        toolCalls: [
          {
            tool: 'esql_query',
            args: { query: 'FROM logs | LIMIT 10' },
            result: { content: [{ type: 'text', text: 'rows returned' }] },
            latencyMs: 20,
          },
        ],
      }),
    );

    expect(mockedCallJudge).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: expect.stringContaining('esql_query'),
      }),
    );
  });

  it('handles context with no tool calls', async () => {
    mockedCallJudge.mockResolvedValueOnce({
      score: 0.7,
      label: 'GOOD',
      explanation: 'No tools needed',
    });

    const result = await evaluator.evaluate(makeContext({ prompt: 'Hello' }));

    expect(result.score).toBe(0.7);
    expect(result.pass).toBe(true);
  });
});
