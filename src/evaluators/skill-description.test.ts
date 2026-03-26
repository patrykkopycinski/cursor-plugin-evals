import { describe, it, expect, vi } from 'vitest';

vi.mock('./llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 0.85, label: 'GOOD',
    explanation: '{"clarity": 0.9, "specificity": 0.8, "actionability": 0.85, "uniqueness": 0.85, "issues": []}',
  }),
  handleJudgeError: vi.fn((name: string, err: unknown) => ({ evaluator: name, score: 0, pass: false, label: 'error', explanation: String(err) })),
}));

import { SkillDescriptionEvaluator } from './skill-description.js';

describe('SkillDescriptionEvaluator', () => {
  it('scores a clear description', async () => {
    const evaluator = new SkillDescriptionEvaluator();
    const result = await evaluator.evaluate({
      testName: 'desc', prompt: '', toolCalls: [],
      config: { 'skill-description': { description: 'Generate ES|QL queries from natural language', otherDescriptions: ['Manage dashboards'] } },
    });
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.metadata?.clarity).toBeDefined();
    expect(result.metadata?.specificity).toBeDefined();
  });

  it('skips when no description', async () => {
    const evaluator = new SkillDescriptionEvaluator();
    const result = await evaluator.evaluate({ testName: 'no-desc', prompt: '', toolCalls: [] });
    expect(result.skipped).toBe(true);
  });

  it('includes issues in metadata', async () => {
    const evaluator = new SkillDescriptionEvaluator();
    const result = await evaluator.evaluate({
      testName: 'issues', prompt: '', toolCalls: [],
      config: { 'skill-description': { description: 'Does stuff' } },
    });
    expect(result.metadata?.issues).toBeDefined();
  });
});
