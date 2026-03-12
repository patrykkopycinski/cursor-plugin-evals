import { describe, it, expect } from 'vitest';
import { KeywordsEvaluator } from './keywords.js';
import type { EvaluatorContext } from '../core/types.js';

function makeContext(overrides: Partial<EvaluatorContext> = {}): EvaluatorContext {
  return {
    testName: 'test-1',
    prompt: 'What is Elasticsearch?',
    toolCalls: [],
    finalOutput: 'Elasticsearch is a distributed search and analytics engine.',
    expected: { responseContains: ['Elasticsearch', 'search'] },
    ...overrides,
  };
}

describe('KeywordsEvaluator', () => {
  const evaluator = new KeywordsEvaluator();

  it('has correct name and kind', () => {
    expect(evaluator.name).toBe('keywords');
    expect(evaluator.kind).toBe('CODE');
  });

  it('returns score 1.0 when all keywords found', async () => {
    const result = await evaluator.evaluate(makeContext());
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('all_found');
  });

  it('returns partial score for partial match', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        finalOutput: 'Elasticsearch is great.',
        expected: { responseContains: ['Elasticsearch', 'distributed', 'analytics', 'engine'] },
      }),
    );
    expect(result.score).toBe(0.25);
    expect(result.pass).toBe(false);
    expect(result.label).toBe('missing');
    expect(result.metadata?.missing).toContain('distributed');
  });

  it('returns score 0 when no keywords found', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        finalOutput: 'The weather is nice today.',
        expected: { responseContains: ['Elasticsearch', 'search'] },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.label).toBe('missing');
  });

  it('performs case-insensitive matching', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        finalOutput: 'ELASTICSEARCH is a SEARCH engine',
        expected: { responseContains: ['elasticsearch', 'search'] },
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('returns score 1.0 when no expected keywords specified', async () => {
    const result = await evaluator.evaluate(makeContext({ expected: undefined }));
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('no_keywords');
  });

  it('uses custom threshold from config', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        finalOutput: 'Kibana is a visualization tool.',
        expected: { responseContains: ['Kibana', 'dashboard', 'analytics'] },
        config: { keywords: 0.3 },
      }),
    );
    expect(result.score).toBeCloseTo(1 / 3);
    expect(result.pass).toBe(true);
  });

  it('fails with default threshold 0.7 when only 1/2 found', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        finalOutput: 'Kibana provides visualizations.',
        expected: { responseContains: ['Kibana', 'dashboard'] },
      }),
    );
    expect(result.score).toBe(0.5);
    expect(result.pass).toBe(false);
  });

  it('includes found and missing arrays in metadata', async () => {
    const result = await evaluator.evaluate(
      makeContext({
        finalOutput: 'Kibana provides visualizations.',
        expected: { responseContains: ['Kibana', 'dashboard', 'analytics'] },
      }),
    );
    expect(result.metadata?.found).toEqual(['Kibana']);
    expect(result.metadata?.missing).toEqual(['dashboard', 'analytics']);
  });
});
