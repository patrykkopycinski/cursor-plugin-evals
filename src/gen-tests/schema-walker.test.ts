import { describe, it, expect } from 'vitest';
import { generateTestsFromSchema } from './schema-walker.js';
import type { GeneratedTest } from './schema-walker.js';

describe('generateTestsFromSchema', () => {
  it('generates a no-args test for empty schema', () => {
    const tests = generateTestsFromSchema('ping', {});
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe('ping-valid-no-args');
    expect(tests[0].category).toBe('valid');
    expect(tests[0].args).toEqual({});
  });

  it('generates valid, boundary, and negative tests for a string property', () => {
    const schema = {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    };

    const tests = generateTestsFromSchema('search', schema);
    const categories = new Set(tests.map((t) => t.category));
    expect(categories).toContain('valid');
    expect(categories).toContain('boundary');
    expect(categories).toContain('negative');

    const validAll = tests.find((t) => t.name === 'search-valid-all-fields');
    expect(validAll).toBeDefined();
    expect(typeof validAll!.args.query).toBe('string');
    expect((validAll!.args.query as string).length).toBeGreaterThan(0);
  });

  it('generates tests for integer properties with min/max', () => {
    const schema = {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['limit'],
    };

    const tests = generateTestsFromSchema('list', schema);
    const validAll = tests.find((t) => t.name === 'list-valid-all-fields');
    expect(validAll).toBeDefined();
    expect(validAll!.args.limit).toBe(50);

    const boundary = tests.find((t) => t.name === 'list-boundary-limit');
    expect(boundary).toBeDefined();
    expect(boundary!.args.limit).toBe(1);
  });

  it('generates enum variant tests', () => {
    const schema = {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'yaml', 'csv'] },
      },
      required: ['format'],
    };

    const tests = generateTestsFromSchema('export', schema);
    const enumTests = tests.filter((t) => t.name.startsWith('export-valid-format-'));
    expect(enumTests).toHaveLength(3);
    expect(enumTests.map((t) => t.args.format)).toEqual(['json', 'yaml', 'csv']);
  });

  it('generates missing-required tests', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
      required: ['name', 'age'],
    };

    const tests = generateTestsFromSchema('create-user', schema);
    const missingName = tests.find((t) => t.name === 'create-user-negative-missing-name');
    expect(missingName).toBeDefined();
    expect(missingName!.args).not.toHaveProperty('name');
    expect(missingName!.args).toHaveProperty('age');
    expect(missingName!.category).toBe('negative');

    const missingAge = tests.find((t) => t.name === 'create-user-negative-missing-age');
    expect(missingAge).toBeDefined();
    expect(missingAge!.args).toHaveProperty('name');
    expect(missingAge!.args).not.toHaveProperty('age');
  });

  it('generates wrong-type tests', () => {
    const schema = {
      type: 'object',
      properties: {
        count: { type: 'number' },
      },
      required: ['count'],
    };

    const tests = generateTestsFromSchema('fetch', schema);
    const wrongType = tests.find((t) => t.name === 'fetch-negative-wrong-type-count');
    expect(wrongType).toBeDefined();
    expect(typeof wrongType!.args.count).toBe('string');
  });

  it('generates null-for-required tests', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    };

    const tests = generateTestsFromSchema('get', schema);
    const nullTest = tests.find((t) => t.name === 'get-negative-null-id');
    expect(nullTest).toBeDefined();
    expect(nullTest!.args.id).toBeNull();
    expect(nullTest!.category).toBe('negative');
  });

  it('generates required-only test when optional fields exist', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        verbose: { type: 'boolean' },
      },
      required: ['id'],
    };

    const tests = generateTestsFromSchema('info', schema);
    const reqOnly = tests.find((t) => t.name === 'info-valid-required-only');
    expect(reqOnly).toBeDefined();
    expect(reqOnly!.args).toHaveProperty('id');
    expect(reqOnly!.args).not.toHaveProperty('verbose');
  });

  it('handles boolean properties', () => {
    const schema = {
      type: 'object',
      properties: {
        dry_run: { type: 'boolean' },
      },
      required: ['dry_run'],
    };

    const tests = generateTestsFromSchema('deploy', schema);
    const validAll = tests.find((t) => t.name === 'deploy-valid-all-fields');
    expect(validAll!.args.dry_run).toBe(true);

    const boundary = tests.find((t) => t.name === 'deploy-boundary-dry_run');
    expect(boundary!.args.dry_run).toBe(false);
  });

  it('handles array properties', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['tags'],
    };

    const tests = generateTestsFromSchema('tag', schema);
    const validAll = tests.find((t) => t.name === 'tag-valid-all-fields');
    expect(Array.isArray(validAll!.args.tags)).toBe(true);
    expect((validAll!.args.tags as unknown[]).length).toBeGreaterThan(0);
  });

  it('all generated tests have required fields', () => {
    const schema = {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 0, maximum: 50 },
        format: { type: 'string', enum: ['json', 'csv'] },
      },
      required: ['query'],
    };

    const tests = generateTestsFromSchema('search', schema);
    expect(tests.length).toBeGreaterThan(0);

    for (const test of tests) {
      expect(test).toHaveProperty('name');
      expect(test).toHaveProperty('tool', 'search');
      expect(test).toHaveProperty('args');
      expect(test).toHaveProperty('category');
      expect(test).toHaveProperty('description');
      expect(['valid', 'boundary', 'negative']).toContain(test.category);
    }
  });
});
