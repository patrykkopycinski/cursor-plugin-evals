import { describe, it, expect, vi } from 'vitest';
import { generateEval, selectEvaluators, selectThresholds, type GeneratedEval } from './generator.js';
import type { SkillProfile } from './analyzer.js';

const ESQL_PROFILE: SkillProfile = {
  name: 'elasticsearch-esql',
  purpose: 'Generate ES|QL queries from natural language',
  capabilities: ['generate ES|QL queries', 'explain query results'],
  expectedTools: ['esql_query'],
  keyDomainTerms: ['FROM', 'WHERE', 'STATS', 'SORT', 'LIMIT'],
  complexity: 'moderate',
  hasCodeOutput: true,
  hasFileOutput: false,
};

vi.mock('../evaluators/llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 1,
    label: 'OK',
    explanation: JSON.stringify({
      tests: [
        { name: 'basic-from-query', prompt: 'Write a FROM query for logs-*', expected: { response_contains: ['FROM', 'logs-*'] }, difficulty: 'simple', category: 'happy-path' },
        { name: 'count-aggregation', prompt: 'Count all logs', expected: { response_contains: ['STATS', 'COUNT'] }, difficulty: 'simple', category: 'happy-path' },
        { name: 'filtered-query', prompt: 'Show errors from last hour', expected: { response_contains: ['WHERE', 'error'] }, difficulty: 'moderate', category: 'happy-path' },
        { name: 'multi-aggregation', prompt: 'Count by host and level', expected: { response_contains: ['STATS', 'BY'] }, difficulty: 'moderate', category: 'edge-case' },
        { name: 'empty-result-handling', prompt: 'Query a non-existent index', expected: { response_contains: ['FROM'] }, difficulty: 'moderate', category: 'edge-case' },
        { name: 'large-limit', prompt: 'Get 10000 results', expected: { response_contains: ['LIMIT'] }, difficulty: 'simple', category: 'boundary' },
        { name: 'invalid-request', prompt: 'Do something impossible with ES|QL', expected: { response_not_contains: ['DROP TABLE'] }, difficulty: 'complex', category: 'negative' },
      ],
    }),
  }),
}));

describe('selectEvaluators', () => {
  it('always includes correctness', () => {
    const evals = selectEvaluators({ ...ESQL_PROFILE, keyDomainTerms: [], expectedTools: [], hasCodeOutput: false });
    expect(evals).toContain('correctness');
  });

  it('adds keywords when domain terms exist', () => {
    expect(selectEvaluators(ESQL_PROFILE)).toContain('keywords');
  });

  it('adds script when skill produces code', () => {
    expect(selectEvaluators(ESQL_PROFILE)).toContain('script');
  });

  it('adds tool-selection when tools expected', () => {
    expect(selectEvaluators(ESQL_PROFILE)).toContain('tool-selection');
  });

  it('adds plan-quality for complex skills', () => {
    const complex = { ...ESQL_PROFILE, complexity: 'complex' as const };
    expect(selectEvaluators(complex)).toContain('plan-quality');
  });
});

describe('selectThresholds', () => {
  it('returns thresholds for selected evaluators', () => {
    const thresholds = selectThresholds(['correctness', 'keywords', 'script']);
    expect(thresholds.correctness).toBe(0.7);
    expect(thresholds.keywords).toBe(0.6);
    expect(thresholds.script).toBe(0.5);
  });
});

describe('generateEval', () => {
  it('produces a GeneratedEval with tests and evaluators', async () => {
    const result = await generateEval(ESQL_PROFILE);
    expect(result.name).toBe('elasticsearch-esql');
    expect(result.tests.length).toBeGreaterThanOrEqual(5);
    expect(result.evaluators).toContain('correctness');
    expect(result.defaults.thresholds.correctness).toBe(0.7);
  });
});
