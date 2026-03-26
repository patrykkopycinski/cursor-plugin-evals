import { describe, it, expect } from 'vitest';
import { MULTI_JUDGE_TIERS, resolveMultiJudgeConfig, type MultiJudgeTier } from './multi-judge.js';

describe('MULTI_JUDGE_TIERS', () => {
  it('has fast tier with 1 cheap judge', () => {
    expect(MULTI_JUDGE_TIERS.fast.judges).toHaveLength(1);
  });

  it('has balanced tier with 2 judges', () => {
    expect(MULTI_JUDGE_TIERS.balanced.judges).toHaveLength(2);
  });

  it('has thorough tier with 3 judges', () => {
    expect(MULTI_JUDGE_TIERS.thorough.judges).toHaveLength(3);
  });
});

describe('resolveMultiJudgeConfig', () => {
  it('returns fast config', () => {
    const config = resolveMultiJudgeConfig('fast');
    expect(config.judges).toHaveLength(1);
  });

  it('returns balanced config', () => {
    const config = resolveMultiJudgeConfig('balanced');
    expect(config.judges).toHaveLength(2);
  });

  it('returns default (thorough) for undefined', () => {
    const config = resolveMultiJudgeConfig();
    expect(config.judges).toHaveLength(3);
  });

  it('returns default for unknown tier', () => {
    const config = resolveMultiJudgeConfig('unknown' as MultiJudgeTier);
    expect(config.judges).toHaveLength(3);
  });
});
