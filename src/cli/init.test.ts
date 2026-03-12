import { describe, it, expect } from 'vitest';
import { generateConfig } from './init.js';
import { buildTestGenerationPrompt, parseGeneratedTests } from './test-generator.js';
import type { PluginManifest } from '../core/types.js';

function createMockManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: 'test-plugin',
    dir: '/tmp/test-plugin',
    skills: [],
    rules: [],
    agents: [],
    commands: [],
    hooks: [],
    mcpServers: [],
    ...overrides,
  };
}

describe('generateConfig', () => {
  it('produces a valid config structure with all layers', () => {
    const manifest = createMockManifest();
    const tools = [{ name: 'search', description: 'Search documents' }];

    const config = generateConfig(manifest, tools);

    expect(config).toHaveProperty('plugin');
    expect(config).toHaveProperty('defaults');
    expect(config).toHaveProperty('suites');

    const plugin = config.plugin as Record<string, unknown>;
    expect(plugin.name).toBe('test-plugin');
    expect(plugin.dir).toBe('/tmp/test-plugin');
    expect(plugin.entry).toBe('node dist/index.js');
  });

  it('generates all four suite layers by default', () => {
    const config = generateConfig(createMockManifest(), [{ name: 'tool1' }]);
    const suites = config.suites as Array<{ layer: string; name: string }>;

    expect(suites).toHaveLength(4);
    expect(suites.map((s) => s.layer)).toEqual(['static', 'unit', 'integration', 'llm']);
  });

  it('includes all 10 static checks', () => {
    const config = generateConfig(createMockManifest(), []);
    const suites = config.suites as Array<{ layer: string; tests: Array<{ check?: string }> }>;
    const staticSuite = suites.find((s) => s.layer === 'static');

    expect(staticSuite).toBeDefined();
    expect(staticSuite!.tests).toHaveLength(10);
  });

  it('includes discovered tool names in unit registration', () => {
    const tools = [
      { name: 'elasticsearch_api', description: 'Query ES' },
      { name: 'kibana_api', description: 'Query Kibana' },
    ];
    const config = generateConfig(createMockManifest(), tools);
    const suites = config.suites as Array<{
      layer: string;
      tests: Array<{ expectedTools?: string[] }>;
    }>;
    const unitSuite = suites.find((s) => s.layer === 'unit');

    expect(unitSuite).toBeDefined();
    expect(unitSuite!.tests[0].expectedTools).toEqual(['elasticsearch_api', 'kibana_api']);
  });

  it('generates one integration test per tool', () => {
    const tools = [
      { name: 'tool_a', description: 'Tool A' },
      { name: 'tool_b', description: 'Tool B' },
    ];
    const config = generateConfig(createMockManifest(), tools);
    const suites = config.suites as Array<{
      layer: string;
      tests: Array<{ name: string; tool?: string }>;
    }>;
    const integrationSuite = suites.find((s) => s.layer === 'integration');

    expect(integrationSuite).toBeDefined();
    expect(integrationSuite!.tests).toHaveLength(2);
    expect(integrationSuite!.tests[0].tool).toBe('tool_a');
    expect(integrationSuite!.tests[1].tool).toBe('tool_b');
  });

  it('generates LLM tests tagged with difficulty: simple', () => {
    const tools = [{ name: 'my_tool', description: 'Does things' }];
    const config = generateConfig(createMockManifest(), tools);
    const suites = config.suites as Array<{
      layer: string;
      tests: Array<{ difficulty?: string }>;
    }>;
    const llmSuite = suites.find((s) => s.layer === 'llm');

    expect(llmSuite).toBeDefined();
    expect(llmSuite!.tests[0].difficulty).toBe('simple');
  });

  it('respects layer filtering', () => {
    const config = generateConfig(createMockManifest(), [], { layers: ['static', 'unit'] });
    const suites = config.suites as Array<{ layer: string }>;

    expect(suites).toHaveLength(2);
    expect(suites.map((s) => s.layer)).toEqual(['static', 'unit']);
  });

  it('sets transport in plugin config when non-stdio', () => {
    const config = generateConfig(createMockManifest(), [], { transport: 'http' });
    const plugin = config.plugin as Record<string, unknown>;

    expect(plugin.transport).toBe('http');
    expect(plugin.url).toBe('http://localhost:3000/mcp');
  });

  it('omits transport for stdio (default)', () => {
    const config = generateConfig(createMockManifest(), []);
    const plugin = config.plugin as Record<string, unknown>;

    expect(plugin.transport).toBeUndefined();
  });

  it('falls back to placeholder when no tools provided', () => {
    const config = generateConfig(createMockManifest(), []);
    const suites = config.suites as Array<{
      layer: string;
      tests: Array<{ tool?: string; prompt?: string }>;
    }>;

    const integration = suites.find((s) => s.layer === 'integration');
    expect(integration!.tests[0].tool).toBe('your_tool_name');

    const llm = suites.find((s) => s.layer === 'llm');
    expect(llm!.tests[0].prompt).toContain('tools are available');
  });

  it('includes defaults with thresholds', () => {
    const config = generateConfig(createMockManifest(), []);
    const defaults = config.defaults as Record<string, unknown>;

    expect(defaults.timeout).toBe(30000);
    expect(defaults.repetitions).toBe(3);
    expect(defaults.judge_model).toBe('gpt-4o');
    expect(defaults.thresholds).toEqual({
      'tool-selection': 0.8,
      'tool-args': 0.7,
    });
  });
});

describe('buildTestGenerationPrompt', () => {
  it('includes tool names and descriptions in prompt', () => {
    const tools = [
      {
        name: 'search_docs',
        description: 'Search documents by query',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' }, limit: { type: 'number' } },
        },
      },
    ];

    const prompt = buildTestGenerationPrompt(tools);

    expect(prompt).toContain('search_docs');
    expect(prompt).toContain('Search documents by query');
    expect(prompt).toContain('query, limit');
  });

  it('handles tools without descriptions', () => {
    const tools = [
      { name: 'my_tool', inputSchema: { type: 'object' } },
    ];

    const prompt = buildTestGenerationPrompt(tools);
    expect(prompt).toContain('my_tool');
    expect(prompt).toContain('No description');
  });
});

describe('parseGeneratedTests', () => {
  it('parses valid JSON array response', () => {
    const response = `[
      {"name": "test-search", "prompt": "Search for docs", "expected_tools": ["search"]},
      {"name": "test-create", "prompt": "Create a doc", "expected_tools": ["create"]}
    ]`;

    const tests = parseGeneratedTests(response);

    expect(tests).toHaveLength(2);
    expect(tests[0].name).toBe('test-search');
    expect(tests[0].prompt).toBe('Search for docs');
    expect(tests[0].expected_tools).toEqual(['search']);
  });

  it('extracts JSON from surrounding text', () => {
    const response = `Here are the tests:\n[{"name": "t1", "prompt": "p1", "expected_tools": ["t"]}]\nDone!`;

    const tests = parseGeneratedTests(response);
    expect(tests).toHaveLength(1);
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseGeneratedTests('not json')).toEqual([]);
    expect(parseGeneratedTests('{}')).toEqual([]);
  });

  it('filters out malformed entries', () => {
    const response = `[
      {"name": "valid", "prompt": "p", "expected_tools": ["t"]},
      {"name": 123, "prompt": "p"},
      {"missing": "fields"}
    ]`;

    const tests = parseGeneratedTests(response);
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe('valid');
  });
});
