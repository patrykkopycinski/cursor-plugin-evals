import { describe, it, expect } from 'vitest';
import { mergeReports } from './merge.js';
import type { RunResult, SuiteResult, TestResult } from '../core/types.js';

function makeTest(name: string, pass: boolean, latencyMs = 100): TestResult {
  return {
    name,
    suite: 'test-suite',
    layer: 'unit',
    pass,
    toolCalls: [],
    evaluatorResults: [
      { evaluator: 'tool-selection', score: pass ? 1 : 0, pass },
    ],
    latencyMs,
  };
}

function makeSuiteResult(name: string, tests: TestResult[]): SuiteResult {
  const passed = tests.filter((t) => t.pass).length;
  const withEvals = tests.filter((t) => t.evaluatorResults.length > 0);
  const evalScores = withEvals.map((t) => t.evaluatorResults[0].score);
  return {
    name,
    layer: 'unit',
    tests,
    passRate: tests.length > 0 ? passed / tests.length : 1,
    duration: tests.reduce((sum, t) => sum + t.latencyMs, 0),
    evaluatorSummary: withEvals.length > 0
      ? {
          'tool-selection': {
            mean: evalScores.reduce((a, b) => a + b, 0) / evalScores.length,
            min: Math.min(...evalScores),
            max: Math.max(...evalScores),
            pass: withEvals.filter((t) => t.evaluatorResults[0].pass).length,
            total: withEvals.length,
          },
        }
      : {},
  };
}

function makeRunResult(suites: SuiteResult[], overrides?: Partial<RunResult>): RunResult {
  const allTests = suites.flatMap((s) => s.tests);
  const passed = allTests.filter((t) => t.pass).length;
  const failed = allTests.length - passed;
  return {
    runId: 'run-1',
    timestamp: '2025-01-01T00:00:00Z',
    config: 'test-plugin',
    suites,
    overall: {
      total: allTests.length,
      passed,
      failed,
      skipped: 0,
      passRate: allTests.length > 0 ? passed / allTests.length : 1,
      duration: suites.reduce((s, suite) => s + suite.duration, 0),
    },
    ...overrides,
  };
}

describe('mergeReports', () => {
  it('returns empty result when given no reports', () => {
    const merged = mergeReports([]);
    expect(merged.suites).toEqual([]);
    expect(merged.overall.total).toBe(0);
    expect(merged.overall.passed).toBe(0);
    expect(merged.overall.passRate).toBe(1);
  });

  it('merges a single report correctly', () => {
    const suite = makeSuiteResult('s1', [makeTest('t1', true), makeTest('t2', false)]);
    const report = makeRunResult([suite]);

    const merged = mergeReports([report]);
    expect(merged.suites).toHaveLength(1);
    expect(merged.overall.total).toBe(2);
    expect(merged.overall.passed).toBe(1);
    expect(merged.overall.failed).toBe(1);
  });

  it('combines suites from multiple reports', () => {
    const report1 = makeRunResult([
      makeSuiteResult('s1', [makeTest('t1', true)]),
    ]);
    const report2 = makeRunResult([
      makeSuiteResult('s2', [makeTest('t2', true), makeTest('t3', false)]),
    ]);

    const merged = mergeReports([report1, report2]);
    expect(merged.suites).toHaveLength(2);
    expect(merged.overall.total).toBe(3);
    expect(merged.overall.passed).toBe(2);
    expect(merged.overall.failed).toBe(1);
    expect(merged.overall.passRate).toBeCloseTo(2 / 3);
  });

  it('sums durations across reports', () => {
    const report1 = makeRunResult([
      makeSuiteResult('s1', [makeTest('t1', true, 200)]),
    ]);
    const report2 = makeRunResult([
      makeSuiteResult('s2', [makeTest('t2', true, 300)]),
    ]);

    const merged = mergeReports([report1, report2]);
    expect(merged.overall.duration).toBe(500);
  });

  it('generates a new runId', () => {
    const report = makeRunResult([
      makeSuiteResult('s1', [makeTest('t1', true)]),
    ]);

    const merged = mergeReports([report]);
    expect(merged.runId).not.toBe(report.runId);
    expect(merged.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('uses the config from the first report', () => {
    const report1 = makeRunResult([], { config: 'plugin-a' });
    const report2 = makeRunResult([], { config: 'plugin-b' });

    const merged = mergeReports([report1, report2]);
    expect(merged.config).toBe('plugin-a');
  });

  it('preserves derived metrics from all reports', () => {
    const report1 = makeRunResult([], {
      derivedMetrics: [{ name: 'metric1', value: 0.9, pass: true }],
    });
    const report2 = makeRunResult([], {
      derivedMetrics: [{ name: 'metric2', value: 0.8, threshold: 0.7, pass: true }],
    });

    const merged = mergeReports([report1, report2]);
    expect(merged.derivedMetrics).toHaveLength(2);
    expect(merged.derivedMetrics![0].name).toBe('metric1');
    expect(merged.derivedMetrics![1].name).toBe('metric2');
  });

  it('handles skipped tests', () => {
    const skippedTest: TestResult = {
      name: 'skipped-test',
      suite: 'test-suite',
      layer: 'unit',
      pass: true,
      skipped: true,
      toolCalls: [],
      evaluatorResults: [],
      latencyMs: 0,
    };
    const suite = makeSuiteResult('s1', [skippedTest, makeTest('t1', true)]);
    const report = makeRunResult([suite]);

    const merged = mergeReports([report]);
    expect(merged.overall.skipped).toBe(1);
    expect(merged.overall.total).toBe(2);
  });
});
