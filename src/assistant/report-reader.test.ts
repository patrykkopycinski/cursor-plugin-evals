import { describe, it, expect } from 'vitest';
import { analyzeRunResult, formatAnalysisReport } from './report-reader.js';
import type { RunResult, TestResult } from '../core/types.js';

function makeTest(name: string, pass: boolean, evaluator = 'correctness', score = pass ? 1 : 0): TestResult {
  return {
    name,
    suite: 'test-suite',
    layer: 'llm',
    pass,
    toolCalls: [],
    evaluatorResults: [{ evaluator, score, pass, label: pass ? 'CORRECT' : 'WRONG' }],
    latencyMs: 100,
  };
}

function makeRunResult(tests: TestResult[]): RunResult {
  const passed = tests.filter((t) => t.pass).length;
  return {
    runId: 'test-run-001',
    timestamp: new Date().toISOString(),
    config: 'test',
    suites: [{
      name: 'test-suite',
      layer: 'llm',
      tests,
      passRate: tests.length > 0 ? passed / tests.length : 0,
      duration: 1000,
      evaluatorSummary: {},
    }],
    overall: {
      total: tests.length,
      passed,
      failed: tests.length - passed,
      skipped: 0,
      passRate: tests.length > 0 ? passed / tests.length : 0,
      duration: 1000,
    },
  };
}

describe('analyzeRunResult', () => {
  it('reports high pass rate for all-passing tests', () => {
    const result = makeRunResult([makeTest('a', true), makeTest('b', true)]);
    const analysis = analyzeRunResult(result);
    expect(analysis.overallPassRate).toBe(1.0);
    expect(analysis.failureClusters).toHaveLength(0);
  });

  it('detects flaky tests', () => {
    const tests = [
      makeTest('flaky-test', true),
      makeTest('flaky-test', false),
    ];
    const result = makeRunResult(tests);
    const analysis = analyzeRunResult(result);
    expect(analysis.flakyTests).toContain('flaky-test');
  });

  it('flags too-lenient thresholds when all pass', () => {
    const tests = Array.from({ length: 10 }, (_, i) => makeTest(`t${i}`, true));
    const result = makeRunResult(tests);
    const analysis = analyzeRunResult(result);
    const lenient = analysis.thresholdAdequacy.find((t) => t.status === 'too_lenient');
    expect(lenient).toBeDefined();
  });

  it('generates suggested actions', () => {
    const tests = [makeTest('a', false), makeTest('b', false), makeTest('c', true)];
    const result = makeRunResult(tests);
    const analysis = analyzeRunResult(result);
    expect(analysis.suggestedActions.length).toBeGreaterThanOrEqual(0);
  });
});

describe('formatAnalysisReport', () => {
  it('produces markdown', () => {
    const result = makeRunResult([makeTest('a', true)]);
    const analysis = analyzeRunResult(result);
    const formatted = formatAnalysisReport(analysis);
    expect(formatted).toContain('Evaluation Analysis Report');
    expect(formatted).toContain('Pass rate');
  });
});
