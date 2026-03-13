import { describe, it, expect } from 'vitest';
import { generateJunitXmlReport } from './junit-xml.js';
import type { RunResult, SuiteResult, TestResult } from '../core/types.js';

function makeTest(overrides: Partial<TestResult> = {}): TestResult {
  return {
    name: 'test-1',
    suite: 'suite-1',
    layer: 'unit',
    pass: true,
    toolCalls: [],
    evaluatorResults: [],
    latencyMs: 1500,
    ...overrides,
  };
}

function makeSuite(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'suite-1',
    layer: 'unit',
    tests: [makeTest()],
    passRate: 1.0,
    duration: 2000,
    evaluatorSummary: {},
    ...overrides,
  };
}

function makeRunResult(suites: SuiteResult[]): RunResult {
  const allTests = suites.flatMap((s) => s.tests);
  const passed = allTests.filter((t) => t.pass).length;
  return {
    runId: 'test-run',
    timestamp: '2026-03-12T00:00:00.000Z',
    config: 'test.yaml',
    suites,
    overall: {
      total: allTests.length,
      passed,
      failed: allTests.length - passed,
      skipped: 0,
      passRate: allTests.length > 0 ? passed / allTests.length : 1,
      duration: 5000,
    },
  };
}

describe('generateJunitXmlReport', () => {
  it('outputs XML declaration', () => {
    const result = makeRunResult([makeSuite()]);
    const xml = generateJunitXmlReport(result);
    expect(xml).toContain('<?xml version="1.0"?>');
  });

  it('contains <testsuites> root element', () => {
    const result = makeRunResult([makeSuite()]);
    const xml = generateJunitXmlReport(result);
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('</testsuites>');
  });

  it('maps suites to <testsuite> elements with attributes', () => {
    const result = makeRunResult([
      makeSuite({ name: 'my-suite', tests: [makeTest(), makeTest({ name: 'test-2' })], duration: 3000 }),
    ]);
    const xml = generateJunitXmlReport(result);
    expect(xml).toContain('<testsuite name="my-suite"');
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('time="3.000"');
  });

  it('maps passing tests to self-closing <testcase> elements', () => {
    const result = makeRunResult([makeSuite()]);
    const xml = generateJunitXmlReport(result);
    expect(xml).toContain('<testcase name="test-1"');
    expect(xml).toContain('/>');
  });

  it('maps failing tests to <testcase> with <failure> elements', () => {
    const result = makeRunResult([
      makeSuite({
        tests: [
          makeTest({
            pass: false,
            evaluatorResults: [
              { evaluator: 'tool-selection', score: 0.3, pass: false, explanation: 'wrong tool selected' },
            ],
          }),
        ],
        passRate: 0,
      }),
    ]);
    const xml = generateJunitXmlReport(result);
    expect(xml).toContain('<failure');
    expect(xml).toContain('tool-selection');
    expect(xml).toContain('0.30');
    expect(xml).toContain('type="evaluator"');
  });

  it('includes timing attributes in seconds', () => {
    const result = makeRunResult([
      makeSuite({ tests: [makeTest({ latencyMs: 2500 })], duration: 3000 }),
    ]);
    const xml = generateJunitXmlReport(result);
    expect(xml).toContain('time="2.500"');
    expect(xml).toContain('time="3.000"');
  });

  it('includes classname with suite name and layer', () => {
    const result = makeRunResult([
      makeSuite({ name: 'integration-smoke', layer: 'integration' }),
    ]);
    const xml = generateJunitXmlReport(result);
    expect(xml).toContain('classname="integration-smoke.integration"');
  });

  it('escapes special XML characters', () => {
    const result = makeRunResult([
      makeSuite({
        name: 'suite-with-<special>&chars',
        tests: [makeTest({ name: 'test "quoted"' })],
      }),
    ]);
    const xml = generateJunitXmlReport(result);
    expect(xml).toContain('&lt;special&gt;&amp;chars');
    expect(xml).toContain('&quot;quoted&quot;');
  });

  it('includes failure details from error field', () => {
    const result = makeRunResult([
      makeSuite({
        tests: [makeTest({ pass: false, error: 'Connection refused' })],
        passRate: 0,
      }),
    ]);
    const xml = generateJunitXmlReport(result);
    expect(xml).toContain('<failure');
    expect(xml).toContain('Connection refused');
  });
});
