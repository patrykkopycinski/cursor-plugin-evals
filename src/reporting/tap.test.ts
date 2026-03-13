import { describe, it, expect } from 'vitest';
import { generateTapReport } from './tap.js';
import type { RunResult, SuiteResult, TestResult } from '../core/types.js';

function makeTest(overrides: Partial<TestResult> = {}): TestResult {
  return {
    name: 'test-1',
    suite: 'suite-1',
    layer: 'unit',
    pass: true,
    toolCalls: [],
    evaluatorResults: [],
    latencyMs: 100,
    ...overrides,
  };
}

function makeSuite(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'suite-1',
    layer: 'unit',
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
  const skipped = allTests.filter((t) => t.skipped).length;
  return {
    runId: 'test-run',
    timestamp: '2026-03-13T00:00:00.000Z',
    config: 'test.yaml',
    suites,
    overall: {
      total: allTests.length,
      passed,
      failed: allTests.length - passed - skipped,
      skipped,
      passRate: allTests.length > 0 ? passed / allTests.length : 1,
      duration: 1000,
    },
  };
}

describe('generateTapReport', () => {
  it('outputs basic passing tests', () => {
    const result = makeRunResult([
      makeSuite({
        tests: [makeTest({ name: 'alpha' }), makeTest({ name: 'beta' })],
      }),
    ]);
    const tap = generateTapReport(result);
    const lines = tap.split('\n');

    expect(lines[0]).toBe('TAP version 14');
    expect(lines[1]).toBe('1..2');
    expect(lines[2]).toBe('ok 1 - suite-1/alpha');
    expect(lines[3]).toBe('ok 2 - suite-1/beta');
  });

  it('outputs mix of pass/fail with YAML diagnostics', () => {
    const result = makeRunResult([
      makeSuite({
        tests: [
          makeTest({ name: 'pass-test' }),
          makeTest({
            name: 'fail-test',
            pass: false,
            evaluatorResults: [
              {
                evaluator: 'tool-selection',
                score: 0.5,
                pass: false,
                explanation: 'Expected tool selection score >= 0.9, got 0.5',
              },
            ],
          }),
        ],
        passRate: 0.5,
      }),
    ]);
    const tap = generateTapReport(result);
    const lines = tap.split('\n');

    expect(lines[1]).toBe('1..2');
    expect(lines[2]).toBe('ok 1 - suite-1/pass-test');
    expect(lines[3]).toBe('not ok 2 - suite-1/fail-test');
    expect(lines[4]).toBe('  ---');
    expect(lines[5]).toContain('tool-selection');
    expect(lines[5]).toContain('score=0.50');
    expect(lines[6]).toBe('  severity: fail');
    expect(lines[7]).toBe('  ...');
  });

  it('outputs empty run with zero count', () => {
    const result = makeRunResult([]);
    const tap = generateTapReport(result);
    const lines = tap.split('\n');

    expect(lines[0]).toBe('TAP version 14');
    expect(lines[1]).toBe('1..0');
    expect(lines).toHaveLength(2);
  });

  it('outputs tests from multiple suites with sequential numbering', () => {
    const result = makeRunResult([
      makeSuite({
        name: 'unit-tests',
        tests: [makeTest({ name: 'a' }), makeTest({ name: 'b' })],
      }),
      makeSuite({
        name: 'integration-tests',
        layer: 'integration',
        tests: [makeTest({ name: 'c' })],
      }),
    ]);
    const tap = generateTapReport(result);
    const lines = tap.split('\n');

    expect(lines[1]).toBe('1..3');
    expect(lines[2]).toBe('ok 1 - unit-tests/a');
    expect(lines[3]).toBe('ok 2 - unit-tests/b');
    expect(lines[4]).toBe('ok 3 - integration-tests/c');
  });

  it('outputs SKIP directive for skipped tests', () => {
    const result = makeRunResult([
      makeSuite({
        tests: [
          makeTest({ name: 'normal' }),
          makeTest({ name: 'skipped-test', skipped: true, error: 'missing env' }),
          makeTest({ name: 'skipped-no-reason', skipped: true }),
        ],
      }),
    ]);
    const tap = generateTapReport(result);
    const lines = tap.split('\n');

    expect(lines[2]).toBe('ok 1 - suite-1/normal');
    expect(lines[3]).toBe('ok 2 - suite-1/skipped-test # SKIP missing env');
    expect(lines[4]).toBe('ok 3 - suite-1/skipped-no-reason # SKIP skipped');
  });

  it('includes error field in diagnostics for failed tests', () => {
    const result = makeRunResult([
      makeSuite({
        tests: [
          makeTest({ name: 'errored', pass: false, error: 'Connection refused' }),
        ],
        passRate: 0,
      }),
    ]);
    const tap = generateTapReport(result);

    expect(tap).toContain('not ok 1 - suite-1/errored');
    expect(tap).toContain('Connection refused');
    expect(tap).toContain('severity: fail');
  });
});
