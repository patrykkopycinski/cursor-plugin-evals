import { convertTools, convertToolsToArray } from './schema-converter.js';
import type { McpToolDefinition } from '../core/types.js';

function makeTool(overrides: Partial<McpToolDefinition> & { name: string }): McpToolDefinition {
  return {
    inputSchema: { type: 'object', properties: {} },
    ...overrides,
  };
}

describe('convertTools', () => {
  it('converts a single tool preserving name, description, and parameters', () => {
    const tool: McpToolDefinition = {
      name: 'search',
      description: 'Search for documents',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    };

    const result = convertTools([tool]);
    expect(result).toHaveProperty('search');

    const fn = result.search;
    expect(fn.type).toBe('function');
    expect(fn.function.name).toBe('search');
    expect(fn.function.description).toBe('Search for documents');
    expect(fn.function.parameters.type).toBe('object');
    expect(fn.function.parameters.properties?.query.type).toBe('string');
    expect(fn.function.parameters.properties?.query.description).toBe('Search query');
    expect(fn.function.parameters.required).toEqual(['query']);
  });

  it('converts multiple tools and returns correct count', () => {
    const tools: McpToolDefinition[] = [
      makeTool({ name: 'tool_a', description: 'A' }),
      makeTool({ name: 'tool_b', description: 'B' }),
      makeTool({ name: 'tool_c', description: 'C' }),
    ];

    const result = convertTools(tools);
    expect(Object.keys(result)).toHaveLength(3);
    expect(result).toHaveProperty('tool_a');
    expect(result).toHaveProperty('tool_b');
    expect(result).toHaveProperty('tool_c');
  });

  it('preserves JSON Schema types (string, number, boolean)', () => {
    const tool = makeTool({
      name: 'typed',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' },
          active: { type: 'boolean' },
        },
      },
    });

    const result = convertTools([tool]);
    const props = result.typed.function.parameters.properties!;
    expect(props.name.type).toBe('string');
    expect(props.count.type).toBe('number');
    expect(props.active.type).toBe('boolean');
  });

  it('handles nested objects recursively', () => {
    const tool = makeTool({
      name: 'nested',
      inputSchema: {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: {
              inner: {
                type: 'object',
                properties: {
                  value: { type: 'string' },
                },
              },
            },
          },
        },
      },
    });

    const result = convertTools([tool]);
    const config = result.nested.function.parameters.properties!.config;
    expect(config.type).toBe('object');
    const inner = config.properties!.inner;
    expect(inner.type).toBe('object');
    expect(inner.properties!.value.type).toBe('string');
  });

  it('handles arrays with items', () => {
    const tool = makeTool({
      name: 'arr',
      inputSchema: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    });

    const result = convertTools([tool]);
    const tags = result.arr.function.parameters.properties!.tags;
    expect(tags.type).toBe('array');
    expect(tags.items?.type).toBe('string');
  });

  it('handles enums', () => {
    const tool = makeTool({
      name: 'enums',
      inputSchema: {
        type: 'object',
        properties: {
          color: { type: 'string', enum: ['red', 'green', 'blue'] },
        },
      },
    });

    const result = convertTools([tool]);
    const color = result.enums.function.parameters.properties!.color;
    expect(color.enum).toEqual(['red', 'green', 'blue']);
  });

  it('handles oneOf discriminated unions', () => {
    const tool = makeTool({
      name: 'union',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            oneOf: [
              { type: 'object', properties: { term: { type: 'string' } } },
              { type: 'object', properties: { range: { type: 'number' } } },
            ],
          },
        },
      },
    });

    const result = convertTools([tool]);
    const filter = result.union.function.parameters.properties!.filter;
    expect(filter.oneOf).toHaveLength(2);
    expect(filter.oneOf![0].properties!.term.type).toBe('string');
    expect(filter.oneOf![1].properties!.range.type).toBe('number');
  });

  it('preserves required fields', () => {
    const tool = makeTool({
      name: 'req',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
        },
        required: ['a'],
      },
    });

    const result = convertTools([tool]);
    expect(result.req.function.parameters.required).toEqual(['a']);
  });

  it('preserves descriptions at all levels', () => {
    const tool = makeTool({
      name: 'desc',
      description: 'Top level',
      inputSchema: {
        type: 'object',
        description: 'Schema level',
        properties: {
          field: { type: 'string', description: 'Field level' },
        },
      },
    });

    const result = convertTools([tool]);
    expect(result.desc.function.description).toBe('Top level');
    expect(result.desc.function.parameters.description).toBe('Schema level');
    expect(result.desc.function.parameters.properties!.field.description).toBe('Field level');
  });

  it('filters tools with allowlist', () => {
    const tools: McpToolDefinition[] = [
      makeTool({ name: 'keep_me' }),
      makeTool({ name: 'drop_me' }),
      makeTool({ name: 'also_keep' }),
    ];

    const result = convertTools(tools, ['keep_me', 'also_keep']);
    expect(Object.keys(result)).toEqual(['keep_me', 'also_keep']);
  });

  it('includes all tools when allowlist is empty', () => {
    const tools: McpToolDefinition[] = [makeTool({ name: 'a' }), makeTool({ name: 'b' })];

    const result = convertTools(tools, []);
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('ignores unknown entries in allowlist', () => {
    const tools: McpToolDefinition[] = [makeTool({ name: 'exists' })];

    const result = convertTools(tools, ['exists', 'ghost']);
    expect(Object.keys(result)).toEqual(['exists']);
  });

  it('returns empty object for empty tool list', () => {
    const result = convertTools([]);
    expect(result).toEqual({});
  });

  it('handles tool with empty inputSchema', () => {
    const tool: McpToolDefinition = {
      name: 'empty_schema',
      inputSchema: {},
    };

    const result = convertTools([tool]);
    expect(result.empty_schema.function.name).toBe('empty_schema');
    expect(result.empty_schema.function.parameters).toEqual({});
  });
});

describe('convertToolsToArray', () => {
  it('returns an array of OpenAI function definitions', () => {
    const tools: McpToolDefinition[] = [
      makeTool({ name: 'x', description: 'X tool' }),
      makeTool({ name: 'y', description: 'Y tool' }),
    ];

    const result = convertToolsToArray(tools);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('x');
    expect(result[1].function.name).toBe('y');
  });

  it('respects allowlist filtering', () => {
    const tools: McpToolDefinition[] = [
      makeTool({ name: 'a' }),
      makeTool({ name: 'b' }),
      makeTool({ name: 'c' }),
    ];

    const result = convertToolsToArray(tools, ['b']);
    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe('b');
  });
});
