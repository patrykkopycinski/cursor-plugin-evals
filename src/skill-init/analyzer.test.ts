import { describe, it, expect, vi } from 'vitest';
import { analyzeSkill, type SkillProfile } from './analyzer.js';

vi.mock('../evaluators/llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 1,
    label: 'OK',
    explanation: JSON.stringify({
      name: 'elasticsearch-esql',
      purpose: 'Generate ES|QL queries from natural language',
      capabilities: ['generate ES|QL queries', 'explain query results'],
      expectedTools: ['esql_query'],
      keyDomainTerms: ['FROM', 'WHERE', 'STATS', 'SORT', 'LIMIT', 'KEEP', 'EVAL'],
      complexity: 'moderate',
      hasCodeOutput: true,
      hasFileOutput: false,
    }),
  }),
}));

describe('analyzeSkill', () => {
  it('extracts a SkillProfile from SKILL.md content', async () => {
    const skillContent = `# ES|QL Skill\n\nThis skill helps users write ES|QL queries...`;
    const profile = await analyzeSkill(skillContent);
    expect(profile.name).toBe('elasticsearch-esql');
    expect(profile.purpose).toBeTruthy();
    expect(profile.capabilities.length).toBeGreaterThan(0);
    expect(profile.keyDomainTerms.length).toBeGreaterThan(0);
    expect(profile.complexity).toBe('moderate');
    expect(profile.hasCodeOutput).toBe(true);
  });

  it('throws if SKILL.md content is empty', async () => {
    await expect(analyzeSkill('')).rejects.toThrow('SKILL.md content is empty');
  });
});
