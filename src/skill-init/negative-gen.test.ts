import { describe, it, expect, vi } from 'vitest';

vi.mock('../evaluators/llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 1, label: 'OK',
    explanation: JSON.stringify({
      tests: [
        { name: 'neg-weather', prompt: 'What is the weather?', expected: { response_not_contains: ['FROM', 'STATS'] }, difficulty: 'simple', category: 'negative' },
        { name: 'neg-recipe', prompt: 'Give me a recipe', expected: { response_not_contains: ['ES|QL'] }, difficulty: 'simple', category: 'negative' },
        { name: 'neg-math', prompt: 'What is 2+2?', expected: { response_not_contains: ['WHERE'] }, difficulty: 'simple', category: 'negative' },
      ],
    }),
  }),
}));

import { generateNegativeTests } from './generator.js';
import type { SkillProfile } from './analyzer.js';

const PROFILE: SkillProfile = {
  name: 'esql', purpose: 'Generate ES|QL queries', capabilities: ['ES|QL'],
  expectedTools: [], keyDomainTerms: ['FROM', 'WHERE'], complexity: 'moderate', hasCodeOutput: true, hasFileOutput: false,
};

describe('generateNegativeTests', () => {
  it('generates off-topic tests', async () => {
    const tests = await generateNegativeTests(PROFILE);
    expect(tests.length).toBeGreaterThanOrEqual(2);
    expect(tests.every(t => t.category === 'negative')).toBe(true);
  });
});
