import { describe, it, expect } from 'vitest';
import { generateDistractors, DISTRACTOR_TEMPLATES } from './distractors.js';
import type { McpToolDefinition } from '../../core/types.js';

const sampleTools: McpToolDefinition[] = [
  {
    name: 'elasticsearch_api',
    description: 'Execute Elasticsearch API requests',
    inputSchema: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' } }, required: ['method', 'path'] },
  },
  {
    name: 'esql_query',
    description: 'Run ES|QL queries against Elasticsearch',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

describe('generateDistractors', () => {
  describe('mode: none', () => {
    it('returns empty array', () => {
      const result = generateDistractors('none', 5, sampleTools);
      expect(result).toEqual([]);
    });
  });

  describe('mode: random', () => {
    it('returns requested count of distractors', () => {
      const result = generateDistractors('random', 3, sampleTools);
      expect(result).toHaveLength(3);
    });

    it('returns up to available templates when count exceeds available', () => {
      const result = generateDistractors('random', 100, sampleTools);
      expect(result.length).toBeLessThanOrEqual(DISTRACTOR_TEMPLATES.length);
    });

    it('returns valid tool definitions', () => {
      const result = generateDistractors('random', 5);
      for (const tool of result) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
      }
    });

    it('does not include tools with same names as existing tools', () => {
      const existing: McpToolDefinition[] = [
        { name: 'send_email', description: 'test', inputSchema: { type: 'object' } },
      ];
      const result = generateDistractors('random', 12, existing);
      const names = result.map((t) => t.name);
      expect(names).not.toContain('send_email');
    });

    it('returns empty array when count is 0', () => {
      const result = generateDistractors('random', 0);
      expect(result).toEqual([]);
    });
  });

  describe('mode: targeted', () => {
    it('generates distractors based on existing tools', () => {
      const result = generateDistractors('targeted', 3, sampleTools);
      expect(result).toHaveLength(3);

      for (const tool of result) {
        expect(tool.name).toBeTruthy();
        expect(tool.name).not.toBe('elasticsearch_api');
        expect(tool.name).not.toBe('esql_query');
      }
    });

    it('generates similar-sounding names', () => {
      const result = generateDistractors('targeted', 2, sampleTools);
      for (const tool of result) {
        const matchesSome = sampleTools.some(
          (existing) =>
            tool.name.includes(existing.name) || existing.name.includes(tool.name.replace(/^(advanced_|legacy_|internal_|beta_|v2_)/, '').replace(/(_extended|_lite|_pro|_async|_batch)(_\d+)?$/, '')),
        );
        expect(matchesSome).toBe(true);
      }
    });

    it('falls back to random templates when no existing tools', () => {
      const result = generateDistractors('targeted', 3);
      expect(result).toHaveLength(3);
      for (const tool of result) {
        expect(tool.name).toBeTruthy();
      }
    });

    it('produces unique names even when generating many', () => {
      const result = generateDistractors('targeted', 10, sampleTools);
      const names = result.map((t) => t.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });
  });
});

describe('DISTRACTOR_TEMPLATES', () => {
  it('has at least 10 templates', () => {
    expect(DISTRACTOR_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it('all templates have unique names', () => {
    const names = DISTRACTOR_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all templates have valid schemas', () => {
    for (const t of DISTRACTOR_TEMPLATES) {
      expect(t.inputSchema.type).toBe('object');
    }
  });
});
