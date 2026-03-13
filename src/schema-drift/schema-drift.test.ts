import { describe, it, expect } from 'vitest';
import { generateProbes, generateValidValue, generateWrongType } from './generator.js';
import { analyzeDrift, formatDriftReport } from './analyzer.js';
import type { McpToolDefinition } from '../core/types.js';
import type { ProbeResult } from './types.js';

const sampleTool: McpToolDefinition = {
  name: 'test_tool',
  description: 'A test tool',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      format: { type: 'string', enum: ['json', 'csv'] },
      verbose: { type: 'boolean' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

describe('generateProbes', () => {
  it('generates probes for a tool', () => {
    const probes = generateProbes(sampleTool);
    expect(probes.length).toBeGreaterThan(5);
  });

  it('includes minimal valid call', () => {
    const probes = generateProbes(sampleTool);
    const minimal = probes.find((p) => p.description.includes('Minimal'));
    expect(minimal).toBeDefined();
    expect(minimal!.expectation).toBe('should_succeed');
    expect(minimal!.args).toHaveProperty('query');
  });

  it('includes empty call for tools with required fields', () => {
    const probes = generateProbes(sampleTool);
    const empty = probes.find((p) => p.description.includes('Empty'));
    expect(empty).toBeDefined();
    expect(empty!.expectation).toBe('should_fail');
  });

  it('includes omission of each required field', () => {
    const probes = generateProbes(sampleTool);
    const omitRequired = probes.filter((p) => p.description.includes('Omit required'));
    expect(omitRequired.length).toBe(1);
    expect(omitRequired[0].targetField).toBe('query');
  });

  it('includes wrong type probes', () => {
    const probes = generateProbes(sampleTool);
    const wrongType = probes.filter((p) => p.description.includes('Wrong type'));
    expect(wrongType.length).toBeGreaterThan(0);
  });

  it('includes enum violation probes', () => {
    const probes = generateProbes(sampleTool);
    const enumProbe = probes.find((p) => p.description.includes('Invalid enum'));
    expect(enumProbe).toBeDefined();
    expect(enumProbe!.targetField).toBe('format');
  });

  it('includes additionalProperties probe', () => {
    const probes = generateProbes(sampleTool);
    const extraProp = probes.find((p) => p.description.includes('Extra unknown'));
    expect(extraProp).toBeDefined();
    expect(extraProp!.expectation).toBe('should_fail');
  });

  it('includes boundary value probes for numeric fields', () => {
    const probes = generateProbes(sampleTool);
    const boundary = probes.filter(
      (p) => p.description.includes('minimum') || p.description.includes('maximum'),
    );
    expect(boundary.length).toBe(2);
  });

  it('handles tool with no required fields', () => {
    const tool: McpToolDefinition = {
      name: 'optional_only',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
    };
    const probes = generateProbes(tool);
    expect(probes.find((p) => p.description.includes('Empty'))).toBeUndefined();
  });

  it('handles tool with no properties', () => {
    const tool: McpToolDefinition = {
      name: 'empty_tool',
      inputSchema: { type: 'object' },
    };
    const probes = generateProbes(tool);
    expect(probes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('generateValidValue', () => {
  it('generates string', () => expect(generateValidValue({ type: 'string' })).toBe('test'));
  it('generates number', () => expect(generateValidValue({ type: 'number' })).toBe(1));
  it('generates integer', () => expect(generateValidValue({ type: 'integer' })).toBe(1));
  it('generates boolean', () => expect(generateValidValue({ type: 'boolean' })).toBe(true));
  it('generates array', () => expect(generateValidValue({ type: 'array' })).toEqual([]));
  it('uses enum first value', () =>
    expect(generateValidValue({ type: 'string', enum: ['a', 'b'] })).toBe('a'));
  it('uses default', () =>
    expect(generateValidValue({ type: 'string', default: 'hello' })).toBe('hello'));
});

describe('generateWrongType', () => {
  it('returns number for string schema', () =>
    expect(generateWrongType({ type: 'string' })).toBe(12345));
  it('returns string for number schema', () =>
    expect(generateWrongType({ type: 'number' })).toBe('not_a_number'));
  it('returns string for boolean schema', () =>
    expect(generateWrongType({ type: 'boolean' })).toBe('not_a_boolean'));
  it('returns undefined for unknown type', () =>
    expect(generateWrongType({})).toBeUndefined());
});

describe('analyzeDrift', () => {
  it('detects hidden required fields', () => {
    const results: ProbeResult[] = [
      {
        input: {
          tool: 't',
          description: 'Omit optional "x"',
          args: {},
          expectation: 'should_succeed',
          targetField: 'x',
        },
        success: false,
        isError: true,
        errorMessage: 'x is required',
      },
    ];
    const report = analyzeDrift(results);
    expect(report.criticalCount).toBe(1);
    expect(report.findings[0].kind).toBe('hidden_required');
  });

  it('detects accepted invalid types', () => {
    const results: ProbeResult[] = [
      {
        input: {
          tool: 't',
          description: 'Wrong type for "x"',
          args: { x: 123 },
          expectation: 'should_fail',
          targetField: 'x',
        },
        success: true,
        isError: false,
      },
    ];
    const report = analyzeDrift(results);
    expect(report.warningCount).toBe(1);
    expect(report.findings[0].kind).toBe('accepts_invalid_type');
  });

  it('detects enum mismatches', () => {
    const results: ProbeResult[] = [
      {
        input: {
          tool: 't',
          description: 'Invalid enum value',
          args: { x: 'bad' },
          expectation: 'should_fail',
          targetField: 'x',
        },
        success: true,
        isError: false,
      },
    ];
    const report = analyzeDrift(results);
    expect(report.findings[0].kind).toBe('enum_mismatch');
  });

  it('reports clean when no drift', () => {
    const results: ProbeResult[] = [
      {
        input: { tool: 't', description: 'ok', args: {}, expectation: 'should_succeed' },
        success: true,
        isError: false,
      },
      {
        input: { tool: 't', description: 'fail', args: {}, expectation: 'should_fail' },
        success: false,
        isError: true,
      },
    ];
    const report = analyzeDrift(results);
    expect(report.findings.length).toBe(0);
    expect(report.driftScore).toBe(1);
  });

  it('clamps drift score to 0-1', () => {
    const many: ProbeResult[] = Array.from({ length: 3 }, () => ({
      input: {
        tool: 't',
        description: 'Omit optional "x"',
        args: {},
        expectation: 'should_succeed' as const,
        targetField: 'x',
      },
      success: false,
      isError: true,
      errorMessage: 'required',
    }));
    const report = analyzeDrift(many);
    expect(report.driftScore).toBeGreaterThanOrEqual(0);
    expect(report.driftScore).toBeLessThanOrEqual(1);
  });
});

describe('formatDriftReport', () => {
  it('formats a report', () => {
    const report = analyzeDrift([]);
    const text = formatDriftReport(report);
    expect(text).toContain('SCHEMA DRIFT REPORT');
    expect(text).toContain('Drift Grade');
  });

  it('includes findings in report', () => {
    const results: ProbeResult[] = [
      {
        input: {
          tool: 'mytool',
          description: 'Omit optional "name"',
          args: {},
          expectation: 'should_succeed',
          targetField: 'name',
        },
        success: false,
        isError: true,
        errorMessage: 'name is required',
      },
    ];
    const report = analyzeDrift(results);
    const text = formatDriftReport(report);
    expect(text).toContain('CRITICAL');
    expect(text).toContain('hidden_required');
    expect(text).toContain('mytool');
  });
});
