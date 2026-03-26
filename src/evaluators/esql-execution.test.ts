import { describe, it, expect, vi } from 'vitest';
import { EsqlExecutionEvaluator } from './esql-execution.js';
import type { EvaluatorContext } from '../core/types.js';

// Mock the esql-utils module
vi.mock('./esql-utils.js', async () => {
  const actual = await vi.importActual<typeof import('./esql-utils.js')>('./esql-utils.js');
  return {
    ...actual,
    executeEsql: vi.fn(),
  };
});

import { executeEsql } from './esql-utils.js';
const mockExecuteEsql = vi.mocked(executeEsql);

function makeContext(output: string, config?: Record<string, unknown>): EvaluatorContext {
  return {
    testName: 'test',
    prompt: 'test prompt',
    toolCalls: [],
    finalOutput: output,
    config: { esUrl: 'http://localhost:9200', ...config },
  };
}

describe('EsqlExecutionEvaluator', () => {
  const evaluator = new EsqlExecutionEvaluator();

  it('scores 1.0 when query executes successfully', async () => {
    mockExecuteEsql.mockResolvedValue({
      columns: [{ name: 'message', type: 'keyword' }],
      values: [['hello']],
    });
    const result = await evaluator.evaluate(makeContext('```esql\nFROM logs | LIMIT 1\n```'));
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('scores 0.4 for index_not_found (valid syntax)', async () => {
    mockExecuteEsql.mockResolvedValue({
      error: 'HTTP 400: index_not_found',
      isIndexNotFound: true,
    });
    const result = await evaluator.evaluate(makeContext('```esql\nFROM nonexistent | LIMIT 1\n```'));
    expect(result.score).toBe(0.4);
    expect(result.pass).toBe(false);
  });

  it('scores 0 for execution errors', async () => {
    mockExecuteEsql.mockResolvedValue({
      error: 'HTTP 400: parsing_exception',
    });
    const result = await evaluator.evaluate(makeContext('```esql\nSELECT * FROM logs\n```'));
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
  });

  it('scores 0 when no ES|QL can be extracted', async () => {
    const result = await evaluator.evaluate(makeContext('No query here'));
    expect(result.score).toBe(0);
    expect(result.label).toBe('no_query');
  });

  it('skips when esUrl is not configured', async () => {
    const result = await evaluator.evaluate(makeContext('```esql\nFROM logs\n```', { esUrl: undefined }));
    expect(result.pass).toBe(false);
    expect(result.label).toBe('no_es_url');
  });
});
