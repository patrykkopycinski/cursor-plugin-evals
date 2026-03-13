import { describe, it, expect } from 'vitest';
import { parseOtelTrace } from './parser.js';

function makeSpan(overrides: Record<string, unknown> = {}) {
  return {
    traceId: 'abc123def456',
    spanId: 'span001',
    name: 'test-span',
    attributes: [],
    ...overrides,
  };
}

function makeOtelJson(spans: unknown[]) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            scope: { name: 'test' },
            spans,
          },
        ],
      },
    ],
  };
}

describe('parseOtelTrace', () => {
  it('parses a minimal valid OTel trace', () => {
    const json = makeOtelJson([makeSpan()]);
    const trace = parseOtelTrace(json);

    expect(trace.traceId).toBe('abc123def456');
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0].name).toBe('test-span');
  });

  it('extracts tool.name from attributes', () => {
    const json = makeOtelJson([
      makeSpan({
        attributes: [
          { key: 'tool.name', value: { stringValue: 'elasticsearch_api' } },
          {
            key: 'tool.args',
            value: { stringValue: '{"method":"GET","path":"/_cat/indices"}' },
          },
          { key: 'tool.result', value: { stringValue: '{"status":"ok"}' } },
        ],
      }),
    ]);

    const trace = parseOtelTrace(json);
    expect(trace.spans[0].toolName).toBe('elasticsearch_api');
    expect(trace.spans[0].toolArgs).toEqual({ method: 'GET', path: '/_cat/indices' });
    expect(trace.spans[0].toolResult).toBe('{"status":"ok"}');
  });

  it('extracts gen_ai prefixed attributes', () => {
    const json = makeOtelJson([
      makeSpan({
        attributes: [
          { key: 'gen_ai.tool.name', value: { stringValue: 'kibana_api' } },
          { key: 'gen_ai.prompt', value: { stringValue: 'List dashboards' } },
        ],
      }),
    ]);

    const trace = parseOtelTrace(json);
    expect(trace.spans[0].toolName).toBe('kibana_api');
    expect(trace.spans[0].parentPrompt).toBe('List dashboards');
  });

  it('extracts mcp prefixed attributes', () => {
    const json = makeOtelJson([
      makeSpan({
        attributes: [
          { key: 'mcp.tool.name', value: { stringValue: 'esql_query' } },
          { key: 'mcp.tool.args', value: { stringValue: '{"query":"FROM logs"}' } },
        ],
      }),
    ]);

    const trace = parseOtelTrace(json);
    expect(trace.spans[0].toolName).toBe('esql_query');
    expect(trace.spans[0].toolArgs).toEqual({ query: 'FROM logs' });
  });

  it('parses integer and double attribute values', () => {
    const json = makeOtelJson([
      makeSpan({
        attributes: [
          { key: 'http.status_code', value: { intValue: 200 } },
          { key: 'duration_ms', value: { doubleValue: 42.5 } },
          { key: 'success', value: { boolValue: true } },
        ],
      }),
    ]);

    const trace = parseOtelTrace(json);
    expect(trace.spans[0].attributes['http.status_code']).toBe(200);
    expect(trace.spans[0].attributes['duration_ms']).toBe(42.5);
    expect(trace.spans[0].attributes['success']).toBe(true);
  });

  it('parses string-encoded intValue', () => {
    const json = makeOtelJson([
      makeSpan({
        attributes: [{ key: 'count', value: { intValue: '99' } }],
      }),
    ]);

    const trace = parseOtelTrace(json);
    expect(trace.spans[0].attributes['count']).toBe(99);
  });

  it('handles multiple resource spans and scope spans', () => {
    const json = {
      resourceSpans: [
        {
          scopeSpans: [{ spans: [makeSpan({ name: 'a' })] }, { spans: [makeSpan({ name: 'b' })] }],
        },
        {
          scopeSpans: [{ spans: [makeSpan({ name: 'c' })] }],
        },
      ],
    };

    const trace = parseOtelTrace(json);
    expect(trace.spans).toHaveLength(3);
    expect(trace.spans.map((s) => s.name)).toEqual(['a', 'b', 'c']);
  });

  it('returns unknown traceId when no spans have one', () => {
    const json = makeOtelJson([{ ...makeSpan(), traceId: '' }]);
    const trace = parseOtelTrace(json);
    expect(trace.traceId).toBe('unknown');
  });

  it('throws for null input', () => {
    expect(() => parseOtelTrace(null)).toThrow('Invalid OTel trace');
  });

  it('throws for missing resourceSpans', () => {
    expect(() => parseOtelTrace({})).toThrow('missing resourceSpans');
  });

  it('handles empty spans gracefully', () => {
    const json = makeOtelJson([]);
    const trace = parseOtelTrace(json);
    expect(trace.spans).toHaveLength(0);
  });

  it('handles array attribute values', () => {
    const json = makeOtelJson([
      makeSpan({
        attributes: [
          {
            key: 'tags',
            value: {
              arrayValue: {
                values: [{ stringValue: 'a' }, { stringValue: 'b' }],
              },
            },
          },
        ],
      }),
    ]);

    const trace = parseOtelTrace(json);
    expect(trace.spans[0].attributes['tags']).toEqual(['a', 'b']);
  });

  it('sets toolArgs undefined when tool.args is not valid JSON', () => {
    const json = makeOtelJson([
      makeSpan({
        attributes: [
          { key: 'tool.name', value: { stringValue: 'test_tool' } },
          { key: 'tool.args', value: { stringValue: 'not-json' } },
        ],
      }),
    ]);

    const trace = parseOtelTrace(json);
    expect(trace.spans[0].toolName).toBe('test_tool');
    expect(trace.spans[0].toolArgs).toBeUndefined();
  });
});
