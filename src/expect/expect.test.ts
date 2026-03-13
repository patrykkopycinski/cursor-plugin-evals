import { FieldAssertion } from './assertions.js';
import {
  field,
  tools,
  toolSequence,
  toolArgs,
  responseContains,
  responseNotContains,
  run,
  maxIterations,
  noErrors,
  latencyUnder,
} from './expect.js';
import { RunAssertion } from './run-assertions.js';
import { defineSuite } from './suite-builder.js';

describe('FieldAssertion', () => {
  it('.eq() produces { field, op: "eq", value }', () => {
    const result = new FieldAssertion('status').eq('ok').toAssertions();
    expect(result).toEqual([{ field: 'status', op: 'eq', value: 'ok' }]);
  });

  it('chaining .gt(5).lt(100) produces two assertions', () => {
    const result = new FieldAssertion('count').gt(5).lt(100).toAssertions();
    expect(result).toEqual([
      { field: 'count', op: 'gt', value: 5 },
      { field: 'count', op: 'lt', value: 100 },
    ]);
  });

  it('all 17 operators produce correct AssertionConfig', () => {
    const fa = new FieldAssertion('f')
      .eq('a')
      .neq('b')
      .gt(1)
      .gte(2)
      .lt(3)
      .lte(4)
      .contains('c')
      .notContains('d')
      .exists()
      .notExists()
      .lengthGte(5)
      .lengthLte(6)
      .type('string')
      .matches('^x$')
      .oneOf([1, 2, 3])
      .startsWith('hello')
      .endsWith('world');

    const assertions = fa.toAssertions();
    expect(assertions).toHaveLength(17);

    const ops = assertions.map((a) => a.op);
    expect(ops).toEqual([
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'contains',
      'not_contains',
      'exists',
      'not_exists',
      'length_gte',
      'length_lte',
      'type',
      'matches',
      'one_of',
      'starts_with',
      'ends_with',
    ]);

    expect(assertions[0]).toEqual({ field: 'f', op: 'eq', value: 'a' });
    expect(assertions[8]).toEqual({ field: 'f', op: 'exists', value: undefined });
    expect(assertions[9]).toEqual({ field: 'f', op: 'not_exists', value: undefined });
    expect(assertions[13]).toEqual({ field: 'f', op: 'matches', value: '^x$' });
    expect(assertions[14]).toEqual({ field: 'f', op: 'one_of', value: [1, 2, 3] });
    expect(assertions[15]).toEqual({ field: 'f', op: 'starts_with', value: 'hello' });
    expect(assertions[16]).toEqual({ field: 'f', op: 'ends_with', value: 'world' });
  });

  it('toAssertions() returns a defensive copy', () => {
    const fa = new FieldAssertion('x').eq(1);
    const a = fa.toAssertions();
    const b = fa.toAssertions();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('.oneOf() produces { field, op: "one_of", value }', () => {
    const result = new FieldAssertion('color').oneOf(['red', 'green', 'blue']).toAssertions();
    expect(result).toEqual([{ field: 'color', op: 'one_of', value: ['red', 'green', 'blue'] }]);
  });

  it('.startsWith() produces { field, op: "starts_with", value }', () => {
    const result = new FieldAssertion('name').startsWith('elastic').toAssertions();
    expect(result).toEqual([{ field: 'name', op: 'starts_with', value: 'elastic' }]);
  });

  it('.endsWith() produces { field, op: "ends_with", value }', () => {
    const result = new FieldAssertion('file').endsWith('.json').toAssertions();
    expect(result).toEqual([{ field: 'file', op: 'ends_with', value: '.json' }]);
  });
});

describe('expect helpers', () => {
  it('field() returns a FieldAssertion', () => {
    const fa = field('response.status');
    expect(fa).toBeInstanceOf(FieldAssertion);
    expect(fa.eq(200).toAssertions()).toEqual([{ field: 'response.status', op: 'eq', value: 200 }]);
  });

  it('tools() produces { tools: [...] }', () => {
    expect(tools(['elasticsearch_api', 'esql_query'])).toEqual({
      tools: ['elasticsearch_api', 'esql_query'],
    });
  });

  it('toolSequence() produces { toolSequence: [...] }', () => {
    expect(toolSequence(['discover_data', 'elasticsearch_api'])).toEqual({
      toolSequence: ['discover_data', 'elasticsearch_api'],
    });
  });

  it('toolArgs() produces { toolArgs: { tool: args } }', () => {
    expect(toolArgs('elasticsearch_api', { method: 'GET', path: '/_cat/indices' })).toEqual({
      toolArgs: { elasticsearch_api: { method: 'GET', path: '/_cat/indices' } },
    });
  });

  it('responseContains() produces { responseContains: [...] }', () => {
    expect(responseContains(['index', 'health'])).toEqual({
      responseContains: ['index', 'health'],
    });
  });

  it('responseNotContains() produces { responseNotContains: [...] }', () => {
    expect(responseNotContains(['error', 'failed'])).toEqual({
      responseNotContains: ['error', 'failed'],
    });
  });

  it('run() returns a RunAssertion', () => {
    const ra = run();
    expect(ra).toBeInstanceOf(RunAssertion);
    expect(ra.noErrors().toChecks()).toEqual([{ type: 'no_errors' }]);
  });

  it('maxIterations() returns a single RunCheck', () => {
    const check = maxIterations(10);
    expect(check).toEqual({ type: 'max_iterations', value: 10 });
  });

  it('noErrors() returns a single RunCheck', () => {
    const check = noErrors();
    expect(check).toEqual({ type: 'no_errors' });
  });

  it('latencyUnder() returns a single RunCheck', () => {
    const check = latencyUnder(3000);
    expect(check).toEqual({ type: 'latency_under', value: 3000 });
  });
});

describe('defineSuite', () => {
  it('produces valid SuiteConfig with correct layer', () => {
    const suite = defineSuite({ name: 'test-suite', layer: 'integration' }, () => {});
    expect(suite).toEqual({
      name: 'test-suite',
      layer: 'integration',
      setup: undefined,
      teardown: undefined,
      defaults: undefined,
      tests: [],
    });
  });

  it('with integration tests compiles correctly', () => {
    const suite = defineSuite(
      { name: 'integration-tests', layer: 'integration', setup: 'docker-compose up' },
      ({ integration }) => {
        integration('GET cluster health', {
          tool: 'elasticsearch_api',
          args: { method: 'GET', path: '/_cluster/health' },
          assert: field('content.0.text').contains('green').toAssertions(),
        });

        integration('list indices', {
          tool: 'elasticsearch_api',
          args: { method: 'GET', path: '/_cat/indices' },
        });
      },
    );

    expect(suite.name).toBe('integration-tests');
    expect(suite.layer).toBe('integration');
    expect(suite.setup).toBe('docker-compose up');
    expect(suite.tests).toHaveLength(2);

    const first = suite.tests[0] as {
      name: string;
      tool: string;
      args: Record<string, unknown>;
      assert?: unknown[];
    };
    expect(first.name).toBe('GET cluster health');
    expect(first.tool).toBe('elasticsearch_api');
    expect(first.args).toEqual({ method: 'GET', path: '/_cluster/health' });
    expect(first.assert).toEqual([{ field: 'content.0.text', op: 'contains', value: 'green' }]);
  });

  it('with llm tests compiles correctly', () => {
    const suite = defineSuite({ name: 'llm-tests', layer: 'llm' }, ({ llm }) => {
      llm('tool selection test', {
        prompt: 'What indices are in the cluster?',
        expected: {
          ...tools(['elasticsearch_api']),
          ...responseContains(['indices']),
        },
        evaluators: ['tool-selection', 'response-quality'],
      });
    });

    expect(suite.name).toBe('llm-tests');
    expect(suite.layer).toBe('llm');
    expect(suite.tests).toHaveLength(1);

    const test = suite.tests[0] as {
      name: string;
      prompt: string;
      expected: Record<string, unknown>;
      evaluators: string[];
    };
    expect(test.name).toBe('tool selection test');
    expect(test.prompt).toBe('What indices are in the cluster?');
    expect(test.expected.tools).toEqual(['elasticsearch_api']);
    expect(test.expected.responseContains).toEqual(['indices']);
    expect(test.evaluators).toEqual(['tool-selection', 'response-quality']);
  });
});
