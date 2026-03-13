import { describe, it, expect, vi } from 'vitest';
import { parse } from 'yaml';
import { formatSmartTestsAsYaml } from './smart-gen.js';
import type { GeneratedTestCase } from './smart-gen.js';

vi.mock('../layers/llm/llm-client.js', () => {
  const mockConverse = vi.fn().mockResolvedValue({
    message: {
      role: 'assistant',
      content: JSON.stringify([
        { prompt: 'Search for logs from the last hour', difficulty: 'simple' },
        { prompt: 'Find error logs in production', difficulty: 'moderate' },
      ]),
    },
    usage: { input: 100, output: 50 },
    finishReason: 'stop',
  });

  class MockLlmClient {
    converse = mockConverse;
  }

  return { LlmClient: MockLlmClient };
});

function makeTestCase(overrides: Partial<GeneratedTestCase> = {}): GeneratedTestCase {
  return {
    name: 'search-standard-std-1-search-for-logs',
    prompt: 'Search for logs from the last hour',
    expectedTools: ['elasticsearch_search'],
    difficulty: 'simple',
    category: 'standard',
    ...overrides,
  };
}

describe('formatSmartTestsAsYaml', () => {
  it('produces valid YAML', () => {
    const tests = [
      makeTestCase(),
      makeTestCase({
        name: 'search-standard-std-2-find-errors',
        prompt: 'Find error logs',
        difficulty: 'moderate',
      }),
    ];

    const yaml = formatSmartTestsAsYaml(tests, 'elastic-plugin');
    const parsed = parse(yaml);
    expect(parsed).toHaveProperty('suites');
    expect(parsed.suites).toHaveLength(1);
    expect(parsed.suites[0].name).toBe('elastic-plugin-elasticsearch_search');
    expect(parsed.suites[0].layer).toBe('llm');
    expect(parsed.suites[0].tests).toHaveLength(2);
  });

  it('groups tests by tool into separate suites', () => {
    const tests = [
      makeTestCase({ expectedTools: ['tool_a'] }),
      makeTestCase({ name: 'b-test', expectedTools: ['tool_b'] }),
      makeTestCase({ name: 'a2-test', expectedTools: ['tool_a'] }),
    ];

    const yaml = formatSmartTestsAsYaml(tests, 'my-suite');
    const parsed = parse(yaml);
    expect(parsed.suites).toHaveLength(2);

    const suiteNames = parsed.suites.map((s: { name: string }) => s.name);
    expect(suiteNames).toContain('my-suite-tool_a');
    expect(suiteNames).toContain('my-suite-tool_b');

    const suiteA = parsed.suites.find((s: { name: string }) => s.name === 'my-suite-tool_a');
    expect(suiteA.tests).toHaveLength(2);
  });

  it('includes expected fields in each test entry', () => {
    const tests = [makeTestCase({ difficulty: 'complex', persona: 'expert', category: 'persona' })];

    const yaml = formatSmartTestsAsYaml(tests, 'suite');
    const parsed = parse(yaml);
    const test = parsed.suites[0].tests[0];

    expect(test).toHaveProperty('name');
    expect(test).toHaveProperty('prompt');
    expect(test).toHaveProperty('expected');
    expect(test.expected).toHaveProperty('tools');
    expect(test).toHaveProperty('evaluators');
    expect(test.evaluators).toContain('tool-match');
    expect(test).toHaveProperty('difficulty', 'complex');
  });

  it('handles empty test array', () => {
    const yaml = formatSmartTestsAsYaml([], 'empty');
    const parsed = parse(yaml);
    expect(parsed.suites).toHaveLength(0);
  });
});

describe('GeneratedTestCase structure', () => {
  it('has all required fields', () => {
    const tc = makeTestCase();
    expect(tc).toHaveProperty('name');
    expect(tc).toHaveProperty('prompt');
    expect(tc).toHaveProperty('expectedTools');
    expect(tc).toHaveProperty('difficulty');
    expect(tc).toHaveProperty('category');
    expect(Array.isArray(tc.expectedTools)).toBe(true);
  });

  it('difficulty must be a valid value', () => {
    const validDifficulties = ['simple', 'moderate', 'complex', 'adversarial'];
    const tc = makeTestCase({ difficulty: 'adversarial' });
    expect(validDifficulties).toContain(tc.difficulty);
  });

  it('category must be a valid value', () => {
    const validCategories = ['standard', 'persona', 'multilingual', 'edge-case'];
    for (const cat of validCategories) {
      const tc = makeTestCase({ category: cat as GeneratedTestCase['category'] });
      expect(validCategories).toContain(tc.category);
    }
  });

  it('optional fields can be set', () => {
    const tc = makeTestCase({ persona: 'expert', language: 'es' });
    expect(tc.persona).toBe('expert');
    expect(tc.language).toBe('es');
  });
});

describe('generateSmartTests (mocked LLM)', () => {
  it('generates tests for each tool', async () => {
    const { generateSmartTests } = await import('./smart-gen.js');
    const tools = [
      {
        name: 'test_search',
        description: 'Search for documents',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search query' } },
          required: ['query'],
        },
      },
    ];

    const results = await generateSmartTests({ tools, count: 2 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.expectedTools.includes('test_search'))).toBe(true);
  });

  it('generates persona variants when requested', async () => {
    const { generateSmartTests } = await import('./smart-gen.js');
    const tools = [
      {
        name: 'tool_x',
        description: 'A tool',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    const results = await generateSmartTests({ tools, count: 2, personas: ['novice'] });
    const personaTests = results.filter((r) => r.category === 'persona');
    expect(personaTests.length).toBeGreaterThan(0);
  });
});
