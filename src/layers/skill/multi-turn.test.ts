import { describe, it, expect } from 'vitest';
import { buildMultiTurnPrompt, extractLastUserPrompt, turnCountByRole, type SkillTurn } from './multi-turn.js';

describe('buildMultiTurnPrompt', () => {
  it('builds single-turn prompt', () => {
    expect(buildMultiTurnPrompt([{ role: 'user', content: 'Hello' }])).toBe('Hello');
  });

  it('builds multi-turn with history', () => {
    const turns: SkillTurn[] = [
      { role: 'user', content: 'What data?' },
      { role: 'assistant', content: 'Found 5 indices' },
      { role: 'user', content: 'Write query' },
    ];
    const result = buildMultiTurnPrompt(turns);
    expect(result).toContain('What data?');
    expect(result).toContain('Found 5 indices');
    expect(result).toContain('Write query');
  });

  it('preserves order', () => {
    const turns: SkillTurn[] = [{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Second' }, { role: 'user', content: 'Third' }];
    const result = buildMultiTurnPrompt(turns);
    expect(result.indexOf('First')).toBeLessThan(result.indexOf('Second'));
    expect(result.indexOf('Second')).toBeLessThan(result.indexOf('Third'));
  });

  it('handles empty turns', () => { expect(buildMultiTurnPrompt([])).toBe(''); });
});

describe('extractLastUserPrompt', () => {
  it('returns last user message', () => {
    const turns: SkillTurn[] = [{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Reply' }, { role: 'user', content: 'Last' }];
    expect(extractLastUserPrompt(turns)).toBe('Last');
  });
  it('returns empty for no user turns', () => { expect(extractLastUserPrompt([])).toBe(''); });
});

describe('turnCountByRole', () => {
  it('counts turns by role', () => {
    const turns: SkillTurn[] = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }];
    const counts = turnCountByRole(turns);
    expect(counts.user).toBe(2);
    expect(counts.assistant).toBe(1);
  });
});
