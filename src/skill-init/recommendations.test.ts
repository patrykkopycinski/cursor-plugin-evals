import { describe, it, expect, vi } from 'vitest';

vi.mock('../evaluators/llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 1,
    label: 'OK',
    explanation: JSON.stringify({
      recommendations: [
        { type: 'test', priority: 'high', message: 'Add a test for DISSECT pattern' },
      ],
    }),
  }),
}));

import { computeDeterministicRecommendations, computeLlmRecommendations, type Recommendation } from './recommendations.js';
import type { RunResult, SuiteResult, TestResult } from '../core/types.js';

function makeSuiteResult(tests: TestResult[]): SuiteResult {
  const passCount = tests.filter((t) => t.pass).length;
  return {
    name: 'skill-suite',
    layer: 'skill',
    tests,
    passRate: tests.length > 0 ? passCount / tests.length : 0,
    duration: 1000,
    evaluatorSummary: {},
  };
}

function makeRunResult(tests: TestResult[]): RunResult {
  const suite = makeSuiteResult(tests);
  return {
    runId: 'test',
    timestamp: new Date().toISOString(),
    config: 'test',
    suites: [suite],
    overall: {
      total: tests.length,
      passed: tests.filter((t) => t.pass).length,
      failed: tests.filter((t) => !t.pass).length,
      skipped: 0,
      passRate: suite.passRate,
      duration: 1000,
    },
  };
}

function makeTest(name: string, score: number, evaluator = 'correctness'): TestResult {
  return {
    name,
    suite: 'skill-suite',
    layer: 'skill',
    pass: score >= 0.5,
    toolCalls: [],
    evaluatorResults: [{ evaluator, score, pass: score >= 0.5 }],
    latencyMs: 100,
  };
}

describe('computeDeterministicRecommendations', () => {
  it('recommends repetitions when pass rate is 100% with repetitions=1', () => {
    const result = makeRunResult([makeTest('a', 1.0), makeTest('b', 1.0)]);
    const evalYaml = { defaults: { repetitions: 1 } };
    const recs = computeDeterministicRecommendations(result, evalYaml);
    expect(recs.some((r) => r.message.includes('repetitions'))).toBe(true);
  });

  it('warns when evaluator scores very low', () => {
    const result = makeRunResult([makeTest('a', 0.1), makeTest('b', 0.2)]);
    const recs = computeDeterministicRecommendations(result, {});
    expect(recs.some((r) => r.message.includes('scored below 0.3'))).toBe(true);
  });

  it('suggests more tests when fewer than 5', () => {
    const result = makeRunResult([makeTest('a', 0.8), makeTest('b', 0.9)]);
    const recs = computeDeterministicRecommendations(result, {});
    expect(recs.some((r) => r.message.includes('more tests'))).toBe(true);
  });

  it('suggests harder tests when all score 1.0', () => {
    const tests = Array.from({ length: 6 }, (_, i) => makeTest(`t${i}`, 1.0));
    const result = makeRunResult(tests);
    const recs = computeDeterministicRecommendations(result, {});
    expect(recs.some((r) => r.message.includes('too easy'))).toBe(true);
  });

  it('returns an array when nothing specific to recommend', () => {
    const tests = Array.from({ length: 6 }, (_, i) => makeTest(`t${i}`, 0.7 + i * 0.03));
    const result = makeRunResult(tests);
    const evalYaml = { defaults: { repetitions: 5 } };
    const recs = computeDeterministicRecommendations(result, evalYaml);
    expect(Array.isArray(recs)).toBe(true);
  });

  it('does not recommend repetitions when already > 1', () => {
    const result = makeRunResult([makeTest('a', 1.0), makeTest('b', 1.0)]);
    const evalYaml = { defaults: { repetitions: 5 } };
    const recs = computeDeterministicRecommendations(result, evalYaml);
    expect(recs.some((r) => r.message.includes('repetitions'))).toBe(false);
  });

  it('does not suggest harder tests when pass rate < 100%', () => {
    const tests = Array.from({ length: 6 }, (_, i) => makeTest(`t${i}`, i < 5 ? 1.0 : 0.3));
    const result = makeRunResult(tests);
    const recs = computeDeterministicRecommendations(result, {});
    expect(recs.some((r) => r.message.includes('too easy'))).toBe(false);
  });

  it('handles empty suites gracefully', () => {
    const result = makeRunResult([]);
    const recs = computeDeterministicRecommendations(result, {});
    expect(Array.isArray(recs)).toBe(true);
  });

  it('handles multiple evaluators scoring low', () => {
    const result = makeRunResult([
      makeTest('a', 0.1, 'correctness'),
      makeTest('b', 0.2, 'keywords'),
    ]);
    const recs = computeDeterministicRecommendations(result, {});
    expect(recs.filter((r) => r.message.includes('scored below 0.3')).length).toBeGreaterThanOrEqual(1);
  });
});

describe('computeLlmRecommendations', () => {
  it('returns recommendations from LLM', async () => {
    const result = makeRunResult([makeTest('a', 0.8)]);
    const recs = await computeLlmRecommendations(result, 'skill content', 'eval yaml content');
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].message).toContain('DISSECT');
  });
});

describe('SKILL.md improvement recommendations', () => {
  function makeFailedTestWithPattern(name: string, unmatched: string[]): TestResult {
    return {
      name,
      suite: 'skill-suite',
      layer: 'skill',
      pass: false,
      toolCalls: [],
      evaluatorResults: [{
        evaluator: 'esql-pattern',
        score: 0.5,
        pass: false,
        explanation: `Missing: ${unmatched.join(', ')}`,
        metadata: { matched: [], unmatched, query: 'FROM logs-test | LIMIT 10' },
      }],
      latencyMs: 100,
    };
  }

  function makeFailedTestWithSyntaxError(name: string, error: string): TestResult {
    return {
      name,
      suite: 'skill-suite',
      layer: 'skill',
      pass: false,
      toolCalls: [],
      evaluatorResults: [{
        evaluator: 'esql-execution',
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Query failed: ${error}`,
        metadata: { query: 'SELECT * FROM logs', error },
      }],
      latencyMs: 100,
    };
  }

  function makeFailedTestNoQuery(name: string): TestResult {
    return {
      name,
      suite: 'skill-suite',
      layer: 'skill',
      pass: false,
      toolCalls: [],
      evaluatorResults: [{
        evaluator: 'esql-execution',
        score: 0,
        pass: false,
        label: 'no_query',
        explanation: 'Could not extract ES|QL query from output or tool calls',
      }],
      latencyMs: 100,
    };
  }

  it('suggests intent-to-command mapping when commands are missing', () => {
    const tests = [
      makeFailedTestWithPattern('test1', ['STATS.*BY']),
      makeFailedTestWithPattern('test2', ['WHERE', 'STATS.*BY']),
      makeTest('passing1', 1.0),
      makeTest('passing2', 1.0),
    ];
    const result = makeRunResult(tests);
    const recs = computeDeterministicRecommendations(result, {}, 'Some skill content');
    const skillRecs = recs.filter((r) => r.type === 'skill_improvement');
    expect(skillRecs.length).toBeGreaterThan(0);
    expect(skillRecs.some((r) => r.message.toLowerCase().includes('command'))).toBe(true);
    expect(skillRecs[0].estimatedImpact).toBeDefined();
    expect(skillRecs[0].skillSuggestion).toBeDefined();
  });

  it('suggests syntax rules when syntax errors occur', () => {
    const tests = [
      makeFailedTestWithSyntaxError('test1', 'syntax error: unexpected SELECT'),
      makeTest('passing1', 1.0),
    ];
    const result = makeRunResult(tests);
    const recs = computeDeterministicRecommendations(result, {}, 'Some skill content');
    const skillRecs = recs.filter((r) => r.type === 'skill_improvement');
    expect(skillRecs.some((r) => r.message.toLowerCase().includes('syntax'))).toBe(true);
  });

  it('suggests query generation rules when no query is extracted', () => {
    const tests = [
      makeFailedTestNoQuery('test1'),
      makeFailedTestNoQuery('test2'),
      makeTest('passing1', 1.0),
    ];
    const result = makeRunResult(tests);
    const recs = computeDeterministicRecommendations(result, {}, 'Some skill content');
    const skillRecs = recs.filter((r) => r.type === 'skill_improvement');
    expect(skillRecs.some((r) => r.message.includes("didn't output a query"))).toBe(true);
  });

  it('skips skill improvements when all tests pass', () => {
    const tests = [makeTest('a', 1.0), makeTest('b', 1.0)];
    const result = makeRunResult(tests);
    const recs = computeDeterministicRecommendations(result, {}, 'Some skill content');
    const skillRecs = recs.filter((r) => r.type === 'skill_improvement');
    expect(skillRecs.length).toBe(0);
  });

  it('skips skill improvements when no skill content provided', () => {
    const tests = [
      makeFailedTestWithPattern('test1', ['STATS.*BY']),
    ];
    const result = makeRunResult(tests);
    const recs = computeDeterministicRecommendations(result, {});
    const skillRecs = recs.filter((r) => r.type === 'skill_improvement');
    expect(skillRecs.length).toBe(0);
  });

  it('detects existing intent-to-command mapping and suggests strengthening', () => {
    const tests = [
      makeFailedTestWithPattern('test1', ['STATS.*BY']),
    ];
    const result = makeRunResult(tests);
    const recs = computeDeterministicRecommendations(result, {}, 'intent-to-command mapping table\nWhen to use STATS');
    const skillRecs = recs.filter((r) => r.type === 'skill_improvement');
    expect(skillRecs.some((r) => r.message.toLowerCase().includes('strengthen'))).toBe(true);
  });
});

describe('computeLlmRecommendations error handling', () => {
  it('returns empty array when LLM returns invalid JSON', async () => {
    const { callJudge } = await import('../evaluators/llm-judge.js');
    (callJudge as any).mockResolvedValueOnce({
      score: 1,
      label: 'OK',
      explanation: 'Not JSON at all',
    });
    const result = makeRunResult([makeTest('a', 0.8)]);
    const recs = await computeLlmRecommendations(result, 'skill', 'yaml');
    expect(recs).toEqual([]);
  });

  it('returns empty array when LLM call throws', async () => {
    const { callJudge } = await import('../evaluators/llm-judge.js');
    (callJudge as any).mockRejectedValueOnce(new Error('API error'));
    const result = makeRunResult([makeTest('a', 0.8)]);
    const recs = await computeLlmRecommendations(result, 'skill', 'yaml');
    expect(recs).toEqual([]);
  });
});
