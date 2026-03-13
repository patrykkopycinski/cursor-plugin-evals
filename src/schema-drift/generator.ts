import type { JsonSchema, McpToolDefinition } from '../core/types.js';
import type { ProbeInput } from './types.js';

export function generateProbes(tool: McpToolDefinition): ProbeInput[] {
  const probes: ProbeInput[] = [];
  const schema = tool.inputSchema;
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const minimalArgs: Record<string, unknown> = {};
  for (const field of required) {
    if (props[field]) {
      minimalArgs[field] = generateValidValue(props[field]);
    }
  }
  probes.push({
    tool: tool.name,
    description: 'Minimal call with only required fields',
    args: minimalArgs,
    expectation: 'should_succeed',
  });

  if (required.size > 0) {
    probes.push({
      tool: tool.name,
      description: 'Empty call — should fail due to missing required fields',
      args: {},
      expectation: 'should_fail',
    });
  }

  for (const [field] of Object.entries(props)) {
    if (required.has(field)) continue;
    const argsWithout = { ...minimalArgs };
    probes.push({
      tool: tool.name,
      description: `Omit optional field "${field}" — should still succeed`,
      args: argsWithout,
      expectation: 'should_succeed',
      targetField: field,
    });
  }

  for (const field of required) {
    const argsWithout = { ...minimalArgs };
    delete argsWithout[field];
    probes.push({
      tool: tool.name,
      description: `Omit required field "${field}" — should fail`,
      args: argsWithout,
      expectation: 'should_fail',
      targetField: field,
    });
  }

  for (const [field, fieldSchema] of Object.entries(props)) {
    const wrongValue = generateWrongType(fieldSchema);
    if (wrongValue === undefined) continue;
    probes.push({
      tool: tool.name,
      description: `Wrong type for "${field}" (expected ${fieldSchema.type ?? 'unknown'})`,
      args: { ...minimalArgs, [field]: wrongValue },
      expectation: 'should_fail',
      targetField: field,
    });
  }

  for (const [field, fieldSchema] of Object.entries(props)) {
    if (!fieldSchema.enum || fieldSchema.enum.length === 0) continue;
    probes.push({
      tool: tool.name,
      description: `Invalid enum value for "${field}"`,
      args: { ...minimalArgs, [field]: '__INVALID_ENUM_VALUE__' },
      expectation: 'should_fail',
      targetField: field,
    });
  }

  if (schema.additionalProperties === false) {
    probes.push({
      tool: tool.name,
      description: 'Extra unknown property — should be rejected',
      args: { ...minimalArgs, __unknown_extra_prop__: 'test' },
      expectation: 'should_fail',
    });
  }

  for (const [field, fieldSchema] of Object.entries(props)) {
    if (fieldSchema.type !== 'number' && fieldSchema.type !== 'integer') continue;
    const min = fieldSchema.minimum as number | undefined;
    const max = fieldSchema.maximum as number | undefined;
    if (min !== undefined) {
      probes.push({
        tool: tool.name,
        description: `Below minimum for "${field}" (min=${min})`,
        args: { ...minimalArgs, [field]: min - 1 },
        expectation: 'should_fail',
        targetField: field,
      });
    }
    if (max !== undefined) {
      probes.push({
        tool: tool.name,
        description: `Above maximum for "${field}" (max=${max})`,
        args: { ...minimalArgs, [field]: max + 1 },
        expectation: 'should_fail',
        targetField: field,
      });
    }
  }

  return probes;
}

export function generateValidValue(schema: JsonSchema): unknown {
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case 'string':
      return 'test';
    case 'number':
      return 1;
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    case 'array':
      return schema.items ? [generateValidValue(schema.items)] : [];
    case 'object': {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        if (schema.required?.includes(k)) {
          obj[k] = generateValidValue(v);
        }
      }
      return obj;
    }
    default:
      return 'test';
  }
}

export function generateWrongType(schema: JsonSchema): unknown {
  switch (schema.type) {
    case 'string':
      return 12345;
    case 'number':
      return 'not_a_number';
    case 'integer':
      return 'not_an_integer';
    case 'boolean':
      return 'not_a_boolean';
    case 'array':
      return 'not_an_array';
    case 'object':
      return 'not_an_object';
    default:
      return undefined;
  }
}
