import { describe, it, expect } from 'vitest';
import { diagnoseFailure, buildFailureTaxonomyReport, type FailureCategory } from './failure-taxonomy.js';
import type { TestResult } from '../core/types.js';

function makeTest(name: string, overrides: Partial<TestResult> = {}): TestResult {
  return { name, suite: 's', layer: 'llm', pass: false, toolCalls: [], evaluatorResults: [], latencyMs: 100, ...overrides };
}

describe('diagnoseFailure', () => {
  it('detects safety violation from security evaluator', () => {
    const test = makeTest('sec', { evaluatorResults: [{ evaluator: 'security', score: 0, pass: false, label: 'VIOLATION' }] });
    expect(diagnoseFailure(test).category).toBe('safety_violation');
  });

  it('detects premature termination when no tools called', () => {
    const test = makeTest('prem', { toolCalls: [], evaluatorResults: [{ evaluator: 'tool-selection', score: 0, pass: false }] });
    expect(diagnoseFailure(test).category).toBe('premature_termination');
  });

  it('detects loop from repeated identical tool calls', () => {
    const tc = { tool: 'search', args: { q: 'test' }, result: { content: [{ type: 'text', text: 'ok' }] }, latencyMs: 50 };
    const test = makeTest('loop', { toolCalls: [tc, tc, tc] });
    expect(diagnoseFailure(test).category).toBe('loop_detection');
  });

  it('detects error handling failure', () => {
    const tc = { tool: 'query', args: {}, result: { content: [{ type: 'text', text: 'error' }], isError: true }, latencyMs: 50 };
    const test = makeTest('err', { toolCalls: [tc] });
    expect(diagnoseFailure(test).category).toBe('error_handling');
  });

  it('detects tool misuse from tool-selection failure', () => {
    const tc = { tool: 'wrong_tool', args: {}, result: { content: [{ type: 'text', text: 'ok' }] }, latencyMs: 50 };
    const test = makeTest('misuse', { toolCalls: [tc], evaluatorResults: [{ evaluator: 'tool-selection', score: 0.2, pass: false }] });
    expect(diagnoseFailure(test).category).toBe('tool_misuse');
  });

  it('detects hallucination from low correctness', () => {
    const test = makeTest('halluc', { evaluatorResults: [{ evaluator: 'correctness', score: 0.1, pass: false }] });
    expect(diagnoseFailure(test).category).toBe('hallucination');
  });

  it('detects plan adherence failure from sequence evaluator', () => {
    const tc = { tool: 'a', args: {}, result: { content: [{ type: 'text', text: 'ok' }] }, latencyMs: 50 };
    const test = makeTest('plan', { toolCalls: [tc], evaluatorResults: [{ evaluator: 'tool-sequence', score: 0.3, pass: false }] });
    expect(diagnoseFailure(test).category).toBe('plan_adherence');
  });

  it('returns unknown for unclassifiable failures', () => {
    const test = makeTest('unk', { evaluatorResults: [{ evaluator: 'response-quality', score: 0.4, pass: false }] });
    expect(diagnoseFailure(test).category).toBe('unknown');
  });

  it('includes suggestion for every category', () => {
    const test = makeTest('sec', { evaluatorResults: [{ evaluator: 'security', score: 0, pass: false }] });
    const diag = diagnoseFailure(test);
    expect(diag.suggestion).toBeTruthy();
    expect(diag.explanation).toBeTruthy();
  });
});

describe('buildFailureTaxonomyReport', () => {
  it('builds report from mixed results', () => {
    const tests = [
      makeTest('pass', { pass: true, evaluatorResults: [{ evaluator: 'correctness', score: 0.9, pass: true }] }),
      makeTest('fail1', { evaluatorResults: [{ evaluator: 'security', score: 0, pass: false }] }),
      makeTest('fail2', { evaluatorResults: [{ evaluator: 'correctness', score: 0.1, pass: false }] }),
    ];
    const report = buildFailureTaxonomyReport(tests);
    expect(report.totalFailed).toBe(2);
    expect(report.diagnoses).toHaveLength(2);
    expect(report.categoryCounts.safety_violation).toBe(1);
    expect(report.categoryCounts.hallucination).toBe(1);
  });

  it('identifies top failure category', () => {
    const tests = [
      makeTest('f1', { evaluatorResults: [{ evaluator: 'security', score: 0, pass: false }] }),
      makeTest('f2', { evaluatorResults: [{ evaluator: 'security', score: 0, pass: false }] }),
      makeTest('f3', { evaluatorResults: [{ evaluator: 'correctness', score: 0.1, pass: false }] }),
    ];
    const report = buildFailureTaxonomyReport(tests);
    expect(report.topCategory).toBe('safety_violation');
  });

  it('returns null topCategory for empty results', () => {
    const report = buildFailureTaxonomyReport([]);
    expect(report.totalFailed).toBe(0);
    expect(report.topCategory).toBeNull();
  });

  it('handles all passing tests', () => {
    const tests = [makeTest('p1', { pass: true }), makeTest('p2', { pass: true })];
    const report = buildFailureTaxonomyReport(tests);
    expect(report.totalFailed).toBe(0);
    expect(report.diagnoses).toHaveLength(0);
  });
});
