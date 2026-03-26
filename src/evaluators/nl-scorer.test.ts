import { describe, it, expect, vi } from 'vitest';

vi.mock('./llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({ score: 0.85, label: 'GOOD', explanation: 'The response is helpful and accurate.' }),
  handleJudgeError: vi.fn((name: string, err: unknown) => ({ evaluator: name, score: 0, pass: false, label: 'error', explanation: err instanceof Error ? err.message : String(err) })),
}));

import { NlScorerEvaluator } from './nl-scorer.js';

describe('NlScorerEvaluator', () => {
  it('generates a scoring prompt from NL description', async () => {
    const evaluator = new NlScorerEvaluator();
    const result = await evaluator.evaluate({
      testName: 'test-1', prompt: 'What is Elasticsearch?', toolCalls: [],
      finalOutput: 'Elasticsearch is a distributed search engine.',
      config: { 'nl-scorer': 'Check if the response accurately explains what Elasticsearch is.' },
    });
    expect(result.evaluator).toBe('nl-scorer');
    expect(result.score).toBeCloseTo(0.85);
    expect(result.pass).toBe(true);
  });

  it('uses default description when none provided', async () => {
    const evaluator = new NlScorerEvaluator();
    const result = await evaluator.evaluate({ testName: 'test-1', prompt: 'Hello', toolCalls: [], finalOutput: 'Hi!', config: {} });
    expect(result.score).toBeCloseTo(0.85);
  });

  it('respects custom threshold', async () => {
    const evaluator = new NlScorerEvaluator();
    const result = await evaluator.evaluate({
      testName: 'test-1', prompt: 'Hello', toolCalls: [], finalOutput: 'Hi',
      config: { 'nl-scorer': 'Is it polite?', 'nl-scorer-threshold': 0.9 },
    });
    expect(result.pass).toBe(false);
  });

  it('includes criterion in metadata', async () => {
    const evaluator = new NlScorerEvaluator();
    const result = await evaluator.evaluate({
      testName: 'test-1', prompt: 'Test', toolCalls: [], finalOutput: 'Result',
      config: { 'nl-scorer': 'My custom criterion' },
    });
    expect(result.metadata?.criterion).toBe('My custom criterion');
  });
});
