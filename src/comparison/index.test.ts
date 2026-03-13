import { describe, it, expect } from 'vitest';
import { buildComparisonFromRuns, formatComparisonTable } from './index.js';
import type { RunResult, SuiteResult, TestResult, Model } from '../core/types.js';

function makeTest(overrides: Partial<TestResult> = {}): TestResult {
  return {
    name: 'test-1',
    suite: 'suite-1',
    layer: 'llm',
    pass: true,
    toolCalls: [],
    evaluatorResults: [{ evaluator: 'correctness', score: 0.9, pass: true }],
    latencyMs: 200,
    ...overrides,
  };
}

function makeSuite(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'suite-1',
    layer: 'llm',
    tests: [makeTest()],
    passRate: 1.0,
    duration: 200,
    evaluatorSummary: {},
    ...overrides,
  };
}

function makeRunResult(suites: SuiteResult[]): RunResult {
  const allTests = suites.flatMap((s) => s.tests);
  const passed = allTests.filter((t) => t.pass).length;
  return {
    runId: 'run-1',
    timestamp: new Date().toISOString(),
    config: 'test.yaml',
    suites,
    overall: {
      total: allTests.length,
      passed,
      failed: allTests.length - passed,
      skipped: 0,
      passRate: allTests.length > 0 ? passed / allTests.length : 1,
      duration: 1000,
    },
  };
}

const modelA: Model = { id: 'gpt-4o', provider: 'openai' };
const modelB: Model = { id: 'claude-sonnet-4-20250514', provider: 'anthropic' };

describe('buildComparisonFromRuns', () => {
  it('handles single model single test', () => {
    const result = buildComparisonFromRuns([
      { model: modelA, result: makeRunResult([makeSuite()]) },
    ]);
    expect(result.models).toHaveLength(1);
    expect(result.matrix.testNames).toContain('test-1');
    expect(result.matrix.evaluatorNames).toContain('correctness');
    expect(result.matrix.aggregates['gpt-4o'].avgScore).toBeCloseTo(0.9);
  });

  it('compares two models across same tests', () => {
    const result = buildComparisonFromRuns([
      { model: modelA, result: makeRunResult([makeSuite()]) },
      {
        model: modelB,
        result: makeRunResult([
          makeSuite({
            tests: [
              makeTest({
                evaluatorResults: [{ evaluator: 'correctness', score: 0.7, pass: true }],
              }),
            ],
          }),
        ]),
      },
    ]);
    expect(result.models).toHaveLength(2);
    expect(result.matrix.aggregates['gpt-4o'].avgScore).toBeCloseTo(0.9);
    expect(result.matrix.aggregates['claude-sonnet-4-20250514'].avgScore).toBeCloseTo(0.7);
  });

  it('classifies pass/fail based on default threshold 0.7', () => {
    const result = buildComparisonFromRuns([
      {
        model: modelA,
        result: makeRunResult([
          makeSuite({
            tests: [
              makeTest({
                name: 'good',
                evaluatorResults: [{ evaluator: 'correctness', score: 0.9, pass: true }],
              }),
              makeTest({
                name: 'bad',
                evaluatorResults: [{ evaluator: 'correctness', score: 0.3, pass: false }],
              }),
            ],
          }),
        ]),
      },
    ]);
    const agg = result.matrix.aggregates['gpt-4o'];
    expect(agg.passCount).toBe(1);
    expect(agg.failCount).toBe(1);
  });

  it('respects custom passThreshold', () => {
    const result = buildComparisonFromRuns(
      [
        {
          model: modelA,
          result: makeRunResult([
            makeSuite({
              tests: [
                makeTest({
                  evaluatorResults: [{ evaluator: 'correctness', score: 0.8, pass: true }],
                }),
              ],
            }),
          ]),
        },
      ],
      0.9,
    );
    expect(result.matrix.aggregates['gpt-4o'].failCount).toBe(1);
  });

  it('sets totalCostUsd to null when no tests have cost', () => {
    const result = buildComparisonFromRuns([
      { model: modelA, result: makeRunResult([makeSuite()]) },
    ]);
    expect(result.matrix.aggregates['gpt-4o'].totalCostUsd).toBeNull();
  });

  it('sums cost when present', () => {
    const result = buildComparisonFromRuns([
      {
        model: modelA,
        result: makeRunResult([
          makeSuite({
            tests: [makeTest({ costUsd: 0.1 }), makeTest({ name: 'test-2', costUsd: 0.25 })],
          }),
        ]),
      },
    ]);
    expect(result.matrix.aggregates['gpt-4o'].totalCostUsd).toBeCloseTo(0.35);
  });

  it('sums latency across all tests', () => {
    const result = buildComparisonFromRuns([
      {
        model: modelA,
        result: makeRunResult([
          makeSuite({
            tests: [makeTest({ latencyMs: 100 }), makeTest({ name: 'test-2', latencyMs: 300 })],
          }),
        ]),
      },
    ]);
    expect(result.matrix.aggregates['gpt-4o'].totalLatencyMs).toBe(400);
  });

  it('generates unique comparison IDs', () => {
    const r1 = buildComparisonFromRuns([{ model: modelA, result: makeRunResult([makeSuite()]) }]);
    const r2 = buildComparisonFromRuns([{ model: modelA, result: makeRunResult([makeSuite()]) }]);
    expect(r1.comparisonId).not.toBe(r2.comparisonId);
  });

  it('handles empty runs', () => {
    const result = buildComparisonFromRuns([]);
    expect(result.models).toHaveLength(0);
    expect(result.matrix.testNames).toHaveLength(0);
  });
});

describe('formatComparisonTable', () => {
  it('produces a table with header row and separator', () => {
    const comparison = buildComparisonFromRuns([
      { model: modelA, result: makeRunResult([makeSuite()]) },
    ]);
    const table = formatComparisonTable(comparison);
    const lines = table.split('\n');
    expect(lines[0]).toContain('Test');
    expect(lines[0]).toContain('gpt-4o');
    expect(lines[1]).toMatch(/^-+/);
  });

  it('includes aggregate lines', () => {
    const comparison = buildComparisonFromRuns([
      { model: modelA, result: makeRunResult([makeSuite()]) },
    ]);
    const table = formatComparisonTable(comparison);
    expect(table).toContain('Aggregates:');
    expect(table).toContain('gpt-4o');
    expect(table).toContain('avg=');
    expect(table).toContain('pass=');
  });

  it('shows cost when present', () => {
    const comparison = buildComparisonFromRuns([
      {
        model: modelA,
        result: makeRunResult([makeSuite({ tests: [makeTest({ costUsd: 0.5 })] })]),
      },
    ]);
    const table = formatComparisonTable(comparison);
    expect(table).toContain('cost=$');
  });

  it('omits cost when null', () => {
    const comparison = buildComparisonFromRuns([
      { model: modelA, result: makeRunResult([makeSuite()]) },
    ]);
    const table = formatComparisonTable(comparison);
    expect(table).not.toContain('cost=$');
  });
});
