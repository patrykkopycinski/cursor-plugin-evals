import { describe, it, expect } from 'vitest';
import { resolveJudgeModel, EVALUATOR_MODEL_TIERS } from './evaluator-models.js';

describe('resolveJudgeModel', () => {
  it('returns explicit model when provided', () => {
    expect(resolveJudgeModel('correctness', 'gpt-4o')).toBe('gpt-4o');
  });

  it('returns cheap model for lightweight evaluators', () => {
    expect(resolveJudgeModel('keywords')).toBe('gpt-5.2-mini');
  });

  it('returns undefined for standard evaluators', () => {
    expect(resolveJudgeModel('correctness')).toBeUndefined();
  });

  it('returns undefined for unknown evaluators', () => {
    expect(resolveJudgeModel('unknown-eval')).toBeUndefined();
  });
});

describe('EVALUATOR_MODEL_TIERS', () => {
  it('has lightweight tier', () => {
    expect(EVALUATOR_MODEL_TIERS.lightweight).toContain('keywords');
    expect(EVALUATOR_MODEL_TIERS.lightweight).toContain('response-quality');
    expect(EVALUATOR_MODEL_TIERS.lightweight).toContain('content-quality');
    expect(EVALUATOR_MODEL_TIERS.lightweight).toContain('similarity');
  });

  it('does not include correctness in lightweight', () => {
    expect(EVALUATOR_MODEL_TIERS.lightweight).not.toContain('correctness');
  });
});
