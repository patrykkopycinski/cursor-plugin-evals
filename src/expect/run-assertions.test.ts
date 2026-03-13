import { RunAssertion, evaluateRunChecks } from './run-assertions.js';
import type { RunCheckContext } from './run-assertions.js';

describe('RunAssertion builder', () => {
  it('maxIterations() produces correct check', () => {
    const checks = new RunAssertion().maxIterations(5).toChecks();
    expect(checks).toEqual([{ type: 'max_iterations', value: 5 }]);
  });

  it('callCount() produces correct check with min only', () => {
    const checks = new RunAssertion().callCount('elasticsearch_api', 1).toChecks();
    expect(checks).toEqual([
      { type: 'call_count', tool: 'elasticsearch_api', min: 1, max: undefined },
    ]);
  });

  it('callCount() produces correct check with min and max', () => {
    const checks = new RunAssertion().callCount('esql_query', 2, 5).toChecks();
    expect(checks).toEqual([{ type: 'call_count', tool: 'esql_query', min: 2, max: 5 }]);
  });

  it('successRate() produces correct check', () => {
    const checks = new RunAssertion().successRate(90).toChecks();
    expect(checks).toEqual([{ type: 'success_rate', value: 90 }]);
  });

  it('totalTools() produces correct check with min only', () => {
    const checks = new RunAssertion().totalTools(3).toChecks();
    expect(checks).toEqual([{ type: 'total_tools', min: 3, max: undefined }]);
  });

  it('totalTools() produces correct check with min and max', () => {
    const checks = new RunAssertion().totalTools(1, 10).toChecks();
    expect(checks).toEqual([{ type: 'total_tools', min: 1, max: 10 }]);
  });

  it('noErrors() produces correct check', () => {
    const checks = new RunAssertion().noErrors().toChecks();
    expect(checks).toEqual([{ type: 'no_errors' }]);
  });

  it('outputMatches() produces correct check', () => {
    const checks = new RunAssertion().outputMatches('^success').toChecks();
    expect(checks).toEqual([{ type: 'output_matches', pattern: '^success' }]);
  });

  it('latencyUnder() produces correct check', () => {
    const checks = new RunAssertion().latencyUnder(5000).toChecks();
    expect(checks).toEqual([{ type: 'latency_under', value: 5000 }]);
  });

  it('chaining multiple checks', () => {
    const checks = new RunAssertion()
      .maxIterations(3)
      .noErrors()
      .latencyUnder(10000)
      .toChecks();
    expect(checks).toHaveLength(3);
    expect(checks[0].type).toBe('max_iterations');
    expect(checks[1].type).toBe('no_errors');
    expect(checks[2].type).toBe('latency_under');
  });

  it('toChecks() returns a defensive copy', () => {
    const ra = new RunAssertion().noErrors();
    const a = ra.toChecks();
    const b = ra.toChecks();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe('evaluateRunChecks', () => {
  const baseContext: RunCheckContext = {
    toolCalls: [
      { tool: 'elasticsearch_api', success: true, latencyMs: 100 },
      { tool: 'esql_query', success: true, latencyMs: 200 },
      { tool: 'elasticsearch_api', success: false, latencyMs: 150 },
    ],
    iterations: 3,
    finalOutput: 'Query completed successfully with 5 results',
    totalLatencyMs: 450,
  };

  it('max_iterations passes when within limit', () => {
    const results = evaluateRunChecks([{ type: 'max_iterations', value: 5 }], baseContext);
    expect(results[0].pass).toBe(true);
    expect(results[0].explanation).toContain('3 iterations');
  });

  it('max_iterations fails when exceeding limit', () => {
    const results = evaluateRunChecks([{ type: 'max_iterations', value: 2 }], baseContext);
    expect(results[0].pass).toBe(false);
    expect(results[0].explanation).toContain('exceeding limit');
  });

  it('max_iterations passes at exact limit', () => {
    const results = evaluateRunChecks([{ type: 'max_iterations', value: 3 }], baseContext);
    expect(results[0].pass).toBe(true);
  });

  it('call_count passes when tool called within range', () => {
    const results = evaluateRunChecks(
      [{ type: 'call_count', tool: 'elasticsearch_api', min: 1, max: 3 }],
      baseContext,
    );
    expect(results[0].pass).toBe(true);
  });

  it('call_count fails when tool called too few times', () => {
    const results = evaluateRunChecks(
      [{ type: 'call_count', tool: 'esql_query', min: 2 }],
      baseContext,
    );
    expect(results[0].pass).toBe(false);
  });

  it('call_count fails when tool called too many times', () => {
    const results = evaluateRunChecks(
      [{ type: 'call_count', tool: 'elasticsearch_api', min: 0, max: 1 }],
      baseContext,
    );
    expect(results[0].pass).toBe(false);
  });

  it('call_count returns 0 for unknown tool', () => {
    const results = evaluateRunChecks(
      [{ type: 'call_count', tool: 'nonexistent', min: 1 }],
      baseContext,
    );
    expect(results[0].pass).toBe(false);
    expect(results[0].explanation).toContain('called 0 times');
  });

  it('success_rate passes when above threshold', () => {
    const results = evaluateRunChecks([{ type: 'success_rate', value: 60 }], baseContext);
    expect(results[0].pass).toBe(true);
    expect(results[0].explanation).toContain('66.7%');
  });

  it('success_rate fails when below threshold', () => {
    const results = evaluateRunChecks([{ type: 'success_rate', value: 80 }], baseContext);
    expect(results[0].pass).toBe(false);
  });

  it('success_rate passes with no tool calls', () => {
    const emptyCtx: RunCheckContext = {
      ...baseContext,
      toolCalls: [],
    };
    const results = evaluateRunChecks([{ type: 'success_rate', value: 100 }], emptyCtx);
    expect(results[0].pass).toBe(true);
    expect(results[0].explanation).toContain('No tool calls');
  });

  it('total_tools passes when count in range', () => {
    const results = evaluateRunChecks([{ type: 'total_tools', min: 2, max: 5 }], baseContext);
    expect(results[0].pass).toBe(true);
  });

  it('total_tools fails when count out of range', () => {
    const results = evaluateRunChecks([{ type: 'total_tools', min: 5 }], baseContext);
    expect(results[0].pass).toBe(false);
  });

  it('no_errors passes when all calls succeed', () => {
    const ctx: RunCheckContext = {
      ...baseContext,
      toolCalls: [
        { tool: 'a', success: true, latencyMs: 10 },
        { tool: 'b', success: true, latencyMs: 20 },
      ],
    };
    const results = evaluateRunChecks([{ type: 'no_errors' }], ctx);
    expect(results[0].pass).toBe(true);
  });

  it('no_errors fails when any call has error', () => {
    const results = evaluateRunChecks([{ type: 'no_errors' }], baseContext);
    expect(results[0].pass).toBe(false);
    expect(results[0].explanation).toContain('elasticsearch_api');
  });

  it('no_errors passes with empty tool calls', () => {
    const ctx: RunCheckContext = { ...baseContext, toolCalls: [] };
    const results = evaluateRunChecks([{ type: 'no_errors' }], ctx);
    expect(results[0].pass).toBe(true);
  });

  it('output_matches passes when pattern matches', () => {
    const results = evaluateRunChecks(
      [{ type: 'output_matches', pattern: '\\d+ results' }],
      baseContext,
    );
    expect(results[0].pass).toBe(true);
  });

  it('output_matches fails when pattern does not match', () => {
    const results = evaluateRunChecks(
      [{ type: 'output_matches', pattern: '^error' }],
      baseContext,
    );
    expect(results[0].pass).toBe(false);
  });

  it('output_matches fails gracefully with invalid regex', () => {
    const results = evaluateRunChecks(
      [{ type: 'output_matches', pattern: '[invalid' }],
      baseContext,
    );
    expect(results[0].pass).toBe(false);
  });

  it('latency_under passes when under limit', () => {
    const results = evaluateRunChecks([{ type: 'latency_under', value: 1000 }], baseContext);
    expect(results[0].pass).toBe(true);
  });

  it('latency_under fails when over limit', () => {
    const results = evaluateRunChecks([{ type: 'latency_under', value: 400 }], baseContext);
    expect(results[0].pass).toBe(false);
  });

  it('latency_under fails at exact limit', () => {
    const results = evaluateRunChecks([{ type: 'latency_under', value: 450 }], baseContext);
    expect(results[0].pass).toBe(false);
  });

  it('evaluates multiple checks at once', () => {
    const checks = new RunAssertion()
      .maxIterations(10)
      .noErrors()
      .latencyUnder(1000)
      .toChecks();

    const results = evaluateRunChecks(checks, baseContext);
    expect(results).toHaveLength(3);
    expect(results[0].pass).toBe(true);
    expect(results[1].pass).toBe(false);
    expect(results[2].pass).toBe(true);
  });

  it('handles 0 iterations', () => {
    const ctx: RunCheckContext = { ...baseContext, iterations: 0, toolCalls: [] };
    const results = evaluateRunChecks([{ type: 'max_iterations', value: 0 }], ctx);
    expect(results[0].pass).toBe(true);
  });
});
