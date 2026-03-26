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

  it('throws when LLM returns no JSON', async () => {
    const { callJudge } = await import('../evaluators/llm-judge.js');
    (callJudge as any).mockResolvedValueOnce({
      score: 1,
      label: 'OK',
      explanation: 'No JSON here, just text',
    });
    await expect(analyzeSkill('# Some Skill')).rejects.toThrow('Failed to parse skill profile');
  });

  it('throws when LLM returns incomplete profile', async () => {
    const { callJudge } = await import('../evaluators/llm-judge.js');
    (callJudge as any).mockResolvedValueOnce({
      score: 1,
      label: 'OK',
      explanation: JSON.stringify({ name: 'test' }), // missing purpose and capabilities
    });
    await expect(analyzeSkill('# Some Skill')).rejects.toThrow('incomplete skill profile');
  });

  it('defaults missing optional fields', async () => {
    const { callJudge } = await import('../evaluators/llm-judge.js');
    (callJudge as any).mockResolvedValueOnce({
      score: 1,
      label: 'OK',
      explanation: JSON.stringify({
        name: 'minimal-skill',
        purpose: 'A minimal skill',
        capabilities: ['do things'],
        // No expectedTools, keyDomainTerms, complexity, hasCodeOutput, hasFileOutput
      }),
    });
    const profile = await analyzeSkill('# Minimal');
    expect(profile.expectedTools).toEqual([]);
    expect(profile.keyDomainTerms).toEqual([]);
    expect(profile.complexity).toBe('moderate');
    expect(profile.hasCodeOutput).toBe(false);
    expect(profile.hasFileOutput).toBe(false);
  });

  it('throws on whitespace-only content', async () => {
    await expect(analyzeSkill('   \n  \t  ')).rejects.toThrow('SKILL.md content is empty');
  });
});
