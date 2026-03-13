import { describe, it, expect } from 'vitest';
import { generateFuzzInputs } from './generator.js';
import { analyzeFuzzResults, formatFuzzReport } from './analyzer.js';
import type { JsonSchema } from '../core/types.js';
import type { FuzzResult } from './types.js';

const schema: JsonSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 1000 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    verbose: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    options: { type: 'object', properties: { x: { type: 'string' } } },
  },
  required: ['query'],
};

describe('generateFuzzInputs', () => {
  it('generates inputs for a schema', () => {
    const inputs = generateFuzzInputs(schema, 'test_tool');
    expect(inputs.length).toBeGreaterThan(20);
  });

  it('includes boundary values for numeric fields', () => {
    const inputs = generateFuzzInputs(schema, 'test_tool');
    const boundaryInputs = inputs.filter(i => i.category === 'boundary');
    expect(boundaryInputs.length).toBeGreaterThan(0);
  });

  it('includes type coercion inputs', () => {
    const inputs = generateFuzzInputs(schema, 'test_tool');
    const coercion = inputs.filter(i => i.category === 'type_coercion');
    expect(coercion.length).toBeGreaterThan(0);
  });

  it('includes null injection inputs', () => {
    const inputs = generateFuzzInputs(schema, 'test_tool');
    const nulls = inputs.filter(i => i.category === 'null_injection');
    expect(nulls.length).toBeGreaterThan(0);
  });

  it('includes overflow inputs', () => {
    const inputs = generateFuzzInputs(schema, 'test_tool');
    const overflow = inputs.filter(i => i.category === 'overflow');
    expect(overflow.length).toBeGreaterThan(0);
  });

  it('includes unicode inputs', () => {
    const inputs = generateFuzzInputs(schema, 'test_tool');
    const unicode = inputs.filter(i => i.category === 'unicode');
    expect(unicode.length).toBeGreaterThan(0);
  });

  it('includes empty object and null body', () => {
    const inputs = generateFuzzInputs(schema, 'test_tool');
    expect(inputs.find(i => i.description === 'empty object')).toBeDefined();
    expect(inputs.find(i => i.description === 'null body')).toBeDefined();
  });

  it('generates combinatorial inputs', () => {
    const inputs = generateFuzzInputs(schema, 'test_tool');
    const combo = inputs.filter(i => i.category === 'combinatorial');
    expect(combo.length).toBeGreaterThan(0);
  });

  it('handles schema with no properties', () => {
    const empty: JsonSchema = { type: 'object' };
    const inputs = generateFuzzInputs(empty, 'empty_tool');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('analyzeFuzzResults', () => {
  it('computes crash rate', () => {
    const results: FuzzResult[] = [
      { input: { description: 'a', args: {}, category: 'boundary' }, accepted: true, isError: false, crashed: false, latencyMs: 10 },
      { input: { description: 'b', args: {}, category: 'boundary' }, accepted: false, isError: true, crashed: true, latencyMs: 10, errorMessage: 'crash' },
    ];
    const report = analyzeFuzzResults('tool', results);
    expect(report.crashRate).toBe(0.5);
    expect(report.crashed).toBe(1);
    expect(report.categories['boundary'].crashed).toBe(1);
  });

  it('handles empty results', () => {
    const report = analyzeFuzzResults('tool', []);
    expect(report.crashRate).toBe(0);
    expect(report.totalInputs).toBe(0);
  });
});

describe('formatFuzzReport', () => {
  it('formats report with grade', () => {
    const report = analyzeFuzzResults('mytool', [
      { input: { description: 'ok', args: {}, category: 'boundary' }, accepted: true, isError: false, crashed: false, latencyMs: 10 },
    ]);
    const text = formatFuzzReport(report);
    expect(text).toContain('FUZZ TESTING REPORT');
    expect(text).toContain('mytool');
    expect(text).toContain('A');
  });

  it('shows crash details', () => {
    const report = analyzeFuzzResults('tool', [
      { input: { description: 'bad input', args: {}, category: 'overflow' }, accepted: false, isError: true, crashed: true, latencyMs: 10, errorMessage: 'OOM' },
    ]);
    const text = formatFuzzReport(report);
    expect(text).toContain('Crash details');
    expect(text).toContain('bad input');
    expect(text).toContain('OOM');
  });
});
