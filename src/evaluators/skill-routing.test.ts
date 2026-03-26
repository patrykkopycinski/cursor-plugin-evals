import { describe, it, expect, vi } from 'vitest';

vi.mock('./llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 0.9, label: 'ACTIVATED',
    explanation: '{"activated": true, "confidence": 0.95, "reasoning": "Prompt matches skill purpose"}',
  }),
  handleJudgeError: vi.fn((name: string, err: unknown) => ({ evaluator: name, score: 0, pass: false, label: 'error', explanation: String(err) })),
}));

import { SkillRoutingEvaluator } from './skill-routing.js';

describe('SkillRoutingEvaluator', () => {
  it('scores 1.0 when skill should activate and LLM says yes', async () => {
    const evaluator = new SkillRoutingEvaluator();
    const result = await evaluator.evaluate({
      testName: 'positive-trigger', prompt: 'Write an ES|QL query', toolCalls: [],
      config: { 'skill-routing': { skillDescription: 'Helps users write ES|QL queries', shouldActivate: true } },
    });
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('CORRECT_ROUTING');
  });

  it('scores high when skill should NOT activate and LLM says no', async () => {
    const { callJudge } = await import('./llm-judge.js');
    (callJudge as any).mockResolvedValueOnce({
      score: 0.1, label: 'NOT_ACTIVATED',
      explanation: '{"activated": false, "confidence": 0.9, "reasoning": "Unrelated"}',
    });
    const evaluator = new SkillRoutingEvaluator();
    const result = await evaluator.evaluate({
      testName: 'negative-trigger', prompt: 'What is the weather?', toolCalls: [],
      config: { 'skill-routing': { skillDescription: 'Helps users write ES|QL queries', shouldActivate: false } },
    });
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.label).toBe('CORRECT_ROUTING');
  });

  it('scores low for false positive', async () => {
    const { callJudge } = await import('./llm-judge.js');
    (callJudge as any).mockResolvedValueOnce({
      score: 0.9, label: 'ACTIVATED',
      explanation: '{"activated": true, "confidence": 0.9, "reasoning": "Wrongly activated"}',
    });
    const evaluator = new SkillRoutingEvaluator();
    const result = await evaluator.evaluate({
      testName: 'false-positive', prompt: 'Weather?', toolCalls: [],
      config: { 'skill-routing': { skillDescription: 'ES|QL queries', shouldActivate: false } },
    });
    expect(result.score).toBeLessThan(0.5);
    expect(result.label).toBe('FALSE_POSITIVE');
  });

  it('skips when no config', async () => {
    const evaluator = new SkillRoutingEvaluator();
    const result = await evaluator.evaluate({ testName: 'no-config', prompt: 'test', toolCalls: [] });
    expect(result.skipped).toBe(true);
  });
});
