import { describe, it, expect } from 'vitest';
import { expandMatrix } from './matrix.js';
import type { SuiteConfig, LlmTestConfig } from './types.js';

function baseSuite(overrides: Partial<SuiteConfig> = {}): SuiteConfig {
  return {
    name: 'test-suite',
    layer: 'llm',
    tests: [
      {
        name: 'basic-prompt',
        prompt: 'hello',
        expected: { tools: ['my_tool'] },
        evaluators: ['tool-selection'],
      } as LlmTestConfig,
    ],
    ...overrides,
  };
}

describe('expandMatrix', () => {
  it('returns the suite unchanged when no matrix is defined', () => {
    const suite = baseSuite();
    const result = expandMatrix(suite);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test-suite');
    expect(result[0].matrix).toBeUndefined();
  });

  it('returns the suite unchanged when matrix is empty', () => {
    const suite = baseSuite({ matrix: {} });
    const result = expandMatrix(suite);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test-suite');
  });

  it('expands a single dimension', () => {
    const suite = baseSuite({ matrix: { model: ['gpt-4', 'claude'] } });
    const result = expandMatrix(suite);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('test-suite[model=gpt-4]');
    expect(result[1].name).toBe('test-suite[model=claude]');
  });

  it('expands two dimensions as cross-product', () => {
    const suite = baseSuite({
      matrix: { model: ['gpt-4', 'claude'], temperature: [0, 0.7] },
    });
    const result = expandMatrix(suite);
    expect(result).toHaveLength(4);

    const names = result.map((s) => s.name);
    expect(names).toContain('test-suite[model=gpt-4,temperature=0]');
    expect(names).toContain('test-suite[model=gpt-4,temperature=0.7]');
    expect(names).toContain('test-suite[model=claude,temperature=0]');
    expect(names).toContain('test-suite[model=claude,temperature=0.7]');
  });

  it('sets the model dimension on LLM test models array', () => {
    const suite = baseSuite({ matrix: { model: ['gpt-4'] } });
    const result = expandMatrix(suite);
    const test = result[0].tests[0] as LlmTestConfig;
    expect(test.models).toEqual(['gpt-4']);
  });

  it('does not overwrite models for non-model dimensions', () => {
    const suite = baseSuite({ matrix: { temperature: [0, 0.7] } });
    const result = expandMatrix(suite);
    const test0 = result[0].tests[0] as LlmTestConfig;
    expect(test0.models).toBeUndefined();
  });

  it('stores non-model dimensions in matrixValues', () => {
    const suite = baseSuite({
      matrix: { model: ['gpt-4'], temperature: [0.5] },
    });
    const result = expandMatrix(suite);
    expect(result[0].matrixValues).toEqual({ model: 'gpt-4', temperature: 0.5 });
  });

  it('removes the matrix field from expanded suites', () => {
    const suite = baseSuite({ matrix: { model: ['a', 'b'] } });
    const result = expandMatrix(suite);
    for (const s of result) {
      expect(s.matrix).toBeUndefined();
    }
  });

  it('preserves all other suite properties', () => {
    const suite = baseSuite({
      layer: 'llm',
      setup: 'setup.sh',
      teardown: 'teardown.sh',
      requireEnv: ['API_KEY'],
      matrix: { model: ['gpt-4'] },
    });
    const result = expandMatrix(suite);
    expect(result[0].layer).toBe('llm');
    expect(result[0].setup).toBe('setup.sh');
    expect(result[0].teardown).toBe('teardown.sh');
    expect(result[0].requireEnv).toEqual(['API_KEY']);
  });

  it('does not mutate the original suite tests', () => {
    const originalTest: LlmTestConfig = {
      name: 'basic-prompt',
      prompt: 'hello',
      expected: { tools: ['my_tool'] },
      evaluators: ['tool-selection'],
      models: ['original-model'],
    };
    const suite = baseSuite({ tests: [originalTest], matrix: { model: ['new-model'] } });
    expandMatrix(suite);
    expect(originalTest.models).toEqual(['original-model']);
  });

  it('handles three dimensions', () => {
    const suite = baseSuite({
      matrix: { model: ['a', 'b'], temperature: [0], max_tokens: [100, 200] },
    });
    const result = expandMatrix(suite);
    expect(result).toHaveLength(4);
  });

  it('handles numeric-only dimension values', () => {
    const suite = baseSuite({ matrix: { temperature: [0, 0.5, 1.0] } });
    const result = expandMatrix(suite);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('test-suite[temperature=0]');
    expect(result[2].name).toBe('test-suite[temperature=1]');
  });

  it('skips model injection for non-LLM tests', () => {
    const suite: SuiteConfig = {
      name: 'unit-suite',
      layer: 'unit',
      tests: [
        {
          name: 'schema-check',
          check: 'schema' as const,
          tool: 'my_tool',
        },
      ],
      matrix: { model: ['gpt-4'] },
    };
    const result = expandMatrix(suite);
    expect(result).toHaveLength(1);
    expect((result[0].tests[0] as Record<string, unknown>).models).toBeUndefined();
  });
});
