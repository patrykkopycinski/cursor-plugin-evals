import { describe, it, expect, vi } from 'vitest';
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
    expect(recs.some((r) => r.message.includes('scores very low'))).toBe(true);
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
});

describe('computeLlmRecommendations', () => {
  it('returns recommendations from LLM', async () => {
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

    const result = makeRunResult([makeTest('a', 0.8)]);
    const recs = await computeLlmRecommendations(result, 'skill content', 'eval yaml content');
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].message).toContain('DISSECT');
  });
});
