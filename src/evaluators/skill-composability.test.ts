import { describe, it, expect, vi } from 'vitest';

vi.mock('./llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 0.85, label: 'COMPATIBLE',
    explanation: '{"compatible": true, "interference": false, "chainable": true, "issues": [], "score": 0.85}',
  }),
  handleJudgeError: vi.fn((name: string, err: unknown) => ({ evaluator: name, score: 0, pass: false, label: 'error', explanation: String(err) })),
}));

import { SkillComposabilityEvaluator } from './skill-composability.js';

describe('SkillComposabilityEvaluator', () => {
  it('scores compatible skills', async () => {
    const evaluator = new SkillComposabilityEvaluator();
    const result = await evaluator.evaluate({
      testName: 'compose', toolCalls: [], prompt: 'discover then query',
      config: { 'skill-composability': { skills: [{ name: 'discovery', description: 'Discover data' }, { name: 'esql', description: 'Write queries' }], scenario: 'Chain discovery into query' } },
    });
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.metadata?.compatible).toBe(true);
  });

  it('skips when no config', async () => {
    const evaluator = new SkillComposabilityEvaluator();
    const result = await evaluator.evaluate({ testName: 'no', prompt: '', toolCalls: [] });
    expect(result.skipped).toBe(true);
  });
});
