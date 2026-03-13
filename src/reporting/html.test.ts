import { describe, it, expect } from 'vitest';
import { generateHtmlReport } from './html.js';
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
    duration: 100,
    evaluatorSummary: {},
    ...overrides,
  };
}

function makeRunResult(suites: SuiteResult[], extra: Partial<RunResult> = {}): RunResult {
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
      duration: 1500,
    },
    ...extra,
  };
}

describe('generateHtmlReport', () => {
  it('outputs valid HTML structure with DOCTYPE', () => {
    const result = makeRunResult([makeSuite()]);
    const html = generateHtmlReport(result);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('contains quality score section when present', () => {
    const result = makeRunResult([makeSuite()], {
      qualityScore: {
        dimensions: { structure: 0.95, correctness: 0.9 },
        composite: 92,
        grade: 'A',
        weights: { structure: 0.3, correctness: 0.7 },
      },
    });
    const html = generateHtmlReport(result);
    expect(html).toContain('quality-section');
    expect(html).toContain('grade-badge');
    expect(html).toContain('A');
    expect(html).toContain('92%');
  });

  it('contains suite names from result', () => {
    const result = makeRunResult([
      makeSuite({ name: 'my-integration-suite' }),
      makeSuite({ name: 'llm-tests', layer: 'llm' }),
    ]);
    const html = generateHtmlReport(result);
    expect(html).toContain('my-integration-suite');
    expect(html).toContain('llm-tests');
  });

  it('contains pass/fail counts', () => {
    const result = makeRunResult([
      makeSuite({
        tests: [makeTest({ pass: true }), makeTest({ name: 'fail-test', pass: false })],
        passRate: 0.5,
      }),
    ]);
    const html = generateHtmlReport(result);
    expect(html).toContain('>1</div>');
    expect(html).toContain('Passed');
    expect(html).toContain('Failed');
  });

  it('includes dark/light mode toggle', () => {
    const result = makeRunResult([makeSuite()]);
    const html = generateHtmlReport(result);
    expect(html).toContain('theme-toggle');
    expect(html).toContain('prefers-color-scheme');
  });

  it('includes performance section when performance metrics exist', () => {
    const result = makeRunResult([
      makeSuite({
        layer: 'performance',
        tests: [
          makeTest({
            layer: 'performance',
            performanceMetrics: {
              p50: 50,
              p95: 95,
              p99: 120,
              mean: 60,
              min: 30,
              max: 150,
              throughput: 10.5,
              memoryDelta: 0,
              samples: 100,
            },
          }),
        ],
      }),
    ]);
    const html = generateHtmlReport(result);
    expect(html).toContain('Performance');
    expect(html).toContain('perf-bar-svg');
  });

  it('includes difficulty breakdown when tests have difficulty tags', () => {
    const result = makeRunResult([
      makeSuite({
        tests: [
          { ...makeTest(), difficulty: 'simple' } as TestResult & { difficulty: string },
          { ...makeTest({ name: 'hard-test' }), difficulty: 'complex' } as TestResult & {
            difficulty: string;
          },
        ],
      }),
    ]);
    const html = generateHtmlReport(result);
    expect(html).toContain('Difficulty Breakdown');
    expect(html).toContain('simple');
    expect(html).toContain('complex');
  });
});
