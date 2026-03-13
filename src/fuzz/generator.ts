import type { JsonSchema } from '../core/types.js';
import type { FuzzInput } from './types.js';

export function generateFuzzInputs(schema: JsonSchema, _toolName: string): FuzzInput[] {
  const inputs: FuzzInput[] = [];
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const validBase: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (required.has(k)) validBase[k] = minimalValue(v);
  }

  inputs.push({ description: 'empty object', args: {}, category: 'empty' });
  inputs.push({ description: 'null body', args: null as unknown as Record<string, unknown>, category: 'null_injection' });

  for (const [field, fieldSchema] of Object.entries(props)) {
    inputs.push(...generateFieldFuzz(field, fieldSchema, validBase));
  }

  if (Object.keys(props).length >= 2) {
    const fieldNames = Object.keys(props);
    for (let i = 0; i < Math.min(fieldNames.length, 3); i++) {
      const subset: Record<string, unknown> = {};
      for (let j = 0; j <= i; j++) {
        subset[fieldNames[j]] = minimalValue(props[fieldNames[j]]);
      }
      inputs.push({ description: `combinatorial: first ${i + 1} fields only`, args: subset, category: 'combinatorial' });
    }
  }

  inputs.push({
    description: 'deeply nested object injection',
    args: { ...validBase, __nested: { a: { b: { c: { d: { e: 'deep' } } } } } },
    category: 'nested',
  });

  return inputs;
}

function generateFieldFuzz(field: string, schema: JsonSchema, base: Record<string, unknown>): FuzzInput[] {
  const inputs: FuzzInput[] = [];

  inputs.push({ description: `${field}: null`, args: { ...base, [field]: null }, category: 'null_injection' });
  inputs.push({ description: `${field}: undefined`, args: { ...base, [field]: undefined }, category: 'null_injection' });
  inputs.push({ description: `${field}: empty string`, args: { ...base, [field]: '' }, category: 'empty' });

  if (schema.type === 'string') {
    inputs.push({ description: `${field}: very long string`, args: { ...base, [field]: 'x'.repeat(100_000) }, category: 'overflow' });
    inputs.push({ description: `${field}: unicode`, args: { ...base, [field]: '🔥💀\u0000\uFFFF' }, category: 'unicode' });
    inputs.push({ description: `${field}: newlines`, args: { ...base, [field]: 'line1\nline2\r\nline3' }, category: 'unicode' });
    inputs.push({ description: `${field}: SQL injection`, args: { ...base, [field]: "'; DROP TABLE users; --" }, category: 'type_coercion' });
    inputs.push({ description: `${field}: number as string`, args: { ...base, [field]: 99999 }, category: 'type_coercion' });
    if (schema.minLength !== undefined) {
      inputs.push({ description: `${field}: below minLength`, args: { ...base, [field]: 'x'.repeat(Math.max(0, (schema.minLength as number) - 1)) }, category: 'boundary' });
    }
    if (schema.maxLength !== undefined) {
      inputs.push({ description: `${field}: above maxLength`, args: { ...base, [field]: 'x'.repeat((schema.maxLength as number) + 1) }, category: 'boundary' });
    }
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    inputs.push({ description: `${field}: zero`, args: { ...base, [field]: 0 }, category: 'boundary' });
    inputs.push({ description: `${field}: negative`, args: { ...base, [field]: -1 }, category: 'boundary' });
    inputs.push({ description: `${field}: MAX_SAFE_INTEGER`, args: { ...base, [field]: Number.MAX_SAFE_INTEGER }, category: 'overflow' });
    inputs.push({ description: `${field}: MIN_SAFE_INTEGER`, args: { ...base, [field]: Number.MIN_SAFE_INTEGER }, category: 'overflow' });
    inputs.push({ description: `${field}: NaN`, args: { ...base, [field]: NaN }, category: 'type_coercion' });
    inputs.push({ description: `${field}: Infinity`, args: { ...base, [field]: Infinity }, category: 'overflow' });
    inputs.push({ description: `${field}: string coercion`, args: { ...base, [field]: '42' }, category: 'type_coercion' });
    const min = schema.minimum as number | undefined;
    const max = schema.maximum as number | undefined;
    if (min !== undefined) {
      inputs.push({ description: `${field}: at minimum`, args: { ...base, [field]: min }, category: 'boundary' });
      inputs.push({ description: `${field}: below minimum`, args: { ...base, [field]: min - 1 }, category: 'boundary' });
    }
    if (max !== undefined) {
      inputs.push({ description: `${field}: at maximum`, args: { ...base, [field]: max }, category: 'boundary' });
      inputs.push({ description: `${field}: above maximum`, args: { ...base, [field]: max + 1 }, category: 'boundary' });
    }
  }

  if (schema.type === 'boolean') {
    inputs.push({ description: `${field}: string 'true'`, args: { ...base, [field]: 'true' }, category: 'type_coercion' });
    inputs.push({ description: `${field}: number 1`, args: { ...base, [field]: 1 }, category: 'type_coercion' });
    inputs.push({ description: `${field}: number 0`, args: { ...base, [field]: 0 }, category: 'type_coercion' });
  }

  if (schema.type === 'array') {
    inputs.push({ description: `${field}: empty array`, args: { ...base, [field]: [] }, category: 'empty' });
    inputs.push({ description: `${field}: huge array`, args: { ...base, [field]: Array(10_000).fill(0) }, category: 'overflow' });
    inputs.push({ description: `${field}: string instead of array`, args: { ...base, [field]: 'not_array' }, category: 'type_coercion' });
  }

  if (schema.type === 'object') {
    inputs.push({ description: `${field}: empty object`, args: { ...base, [field]: {} }, category: 'empty' });
    inputs.push({ description: `${field}: array instead of object`, args: { ...base, [field]: [] }, category: 'type_coercion' });
  }

  return inputs;
}

function minimalValue(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case 'string': return 'test';
    case 'number': case 'integer': return 1;
    case 'boolean': return true;
    case 'array': return [];
    case 'object': return {};
    default: return 'test';
  }
}
