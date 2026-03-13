import type { JsonSchema } from '../core/types.js';

export interface GeneratedTest {
  name: string;
  tool: string;
  args: Record<string, unknown>;
  category: 'valid' | 'boundary' | 'negative';
  description: string;
}

function generateValidValue(schema: JsonSchema, propName: string): unknown {
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (schema.const !== undefined) {
    return schema.const;
  }

  if (schema.default !== undefined) {
    return schema.default;
  }

  switch (schema.type) {
    case 'string': {
      if (schema.pattern) return `match-${propName}`;
      if (schema.format === 'email') return 'user@example.com';
      if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';
      if (schema.format === 'date') return '2025-01-15';
      if (schema.format === 'date-time') return '2025-01-15T10:00:00Z';
      if (schema.format === 'uuid') return '550e8400-e29b-41d4-a716-446655440000';
      if (typeof schema.minLength === 'number' && schema.minLength > 0) {
        return propName
          .repeat(Math.ceil(schema.minLength / propName.length))
          .slice(0, Math.max(schema.minLength, propName.length));
      }
      return `example-${propName}`;
    }
    case 'number':
    case 'integer': {
      const min = typeof schema.minimum === 'number' ? schema.minimum : undefined;
      const max = typeof schema.maximum === 'number' ? schema.maximum : undefined;
      if (min !== undefined && max !== undefined) return Math.floor((min + max) / 2);
      if (min !== undefined) return min + 1;
      if (max !== undefined) return max - 1;
      return schema.type === 'integer' ? 42 : 3.14;
    }
    case 'boolean':
      return true;
    case 'array': {
      if (schema.items) {
        return [generateValidValue(schema.items, propName)];
      }
      return ['item1'];
    }
    case 'object': {
      if (schema.properties) {
        const obj: Record<string, unknown> = {};
        for (const [key, subSchema] of Object.entries(schema.properties)) {
          obj[key] = generateValidValue(subSchema, key);
        }
        return obj;
      }
      return {};
    }
    default:
      return `value-${propName}`;
  }
}

function generateBoundaryValue(schema: JsonSchema, propName: string): unknown | undefined {
  switch (schema.type) {
    case 'string': {
      if (typeof schema.minLength === 'number') return 'x'.repeat(schema.minLength);
      if (typeof schema.maxLength === 'number') return 'x'.repeat(schema.maxLength);
      return '';
    }
    case 'number':
    case 'integer': {
      if (typeof schema.minimum === 'number') return schema.minimum;
      if (typeof schema.maximum === 'number') return schema.maximum;
      return 0;
    }
    case 'array': {
      if (typeof schema.minItems === 'number' && schema.minItems === 0) return [];
      if (typeof schema.maxItems === 'number' && schema.items) {
        return Array.from({ length: schema.maxItems }, (_, i) =>
          generateValidValue(schema.items!, `${propName}_${i}`),
        );
      }
      return [];
    }
    case 'boolean':
      return false;
    default:
      return undefined;
  }
}

function generateNegativeValue(schema: JsonSchema): unknown {
  switch (schema.type) {
    case 'string':
      return 12345;
    case 'number':
    case 'integer':
      return 'not-a-number';
    case 'boolean':
      return 'not-a-boolean';
    case 'array':
      return 'not-an-array';
    case 'object':
      return 'not-an-object';
    default:
      return null;
  }
}

function buildBaseArgs(
  properties: Record<string, JsonSchema>,
  required: string[],
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const name of required) {
    const prop = properties[name];
    if (prop) {
      args[name] = generateValidValue(prop, name);
    }
  }
  return args;
}

export function generateTestsFromSchema(
  toolName: string,
  schema: Record<string, unknown>,
): GeneratedTest[] {
  const tests: GeneratedTest[] = [];
  const typedSchema = schema as JsonSchema;
  const properties = typedSchema.properties ?? {};
  const required = typedSchema.required ?? [];

  if (Object.keys(properties).length === 0) {
    tests.push({
      name: `${toolName}-valid-no-args`,
      tool: toolName,
      args: {},
      category: 'valid',
      description: `Call ${toolName} with no arguments`,
    });
    return tests;
  }

  const validArgs = buildBaseArgs(properties, required);
  for (const [propName, propSchema] of Object.entries(properties)) {
    if (!required.includes(propName)) {
      validArgs[propName] = generateValidValue(propSchema, propName);
    }
  }
  tests.push({
    name: `${toolName}-valid-all-fields`,
    tool: toolName,
    args: validArgs,
    category: 'valid',
    description: `Call ${toolName} with all fields populated`,
  });

  if (required.length > 0 && required.length < Object.keys(properties).length) {
    tests.push({
      name: `${toolName}-valid-required-only`,
      tool: toolName,
      args: buildBaseArgs(properties, required),
      category: 'valid',
      description: `Call ${toolName} with only required fields`,
    });
  }

  for (const [propName, propSchema] of Object.entries(properties)) {
    if (propSchema.enum && propSchema.enum.length > 1) {
      for (const enumVal of propSchema.enum) {
        const args = { ...buildBaseArgs(properties, required), [propName]: enumVal };
        tests.push({
          name: `${toolName}-valid-${propName}-${String(enumVal)}`,
          tool: toolName,
          args,
          category: 'valid',
          description: `Call ${toolName} with ${propName}=${String(enumVal)}`,
        });
      }
    }
  }

  for (const [propName, propSchema] of Object.entries(properties)) {
    const boundaryVal = generateBoundaryValue(propSchema, propName);
    if (boundaryVal !== undefined) {
      const args = { ...buildBaseArgs(properties, required), [propName]: boundaryVal };
      tests.push({
        name: `${toolName}-boundary-${propName}`,
        tool: toolName,
        args,
        category: 'boundary',
        description: `Call ${toolName} with boundary value for ${propName}`,
      });
    }
  }

  for (const reqProp of required) {
    const args = { ...buildBaseArgs(properties, required) };
    delete args[reqProp];
    tests.push({
      name: `${toolName}-negative-missing-${reqProp}`,
      tool: toolName,
      args,
      category: 'negative',
      description: `Call ${toolName} with required field ${reqProp} missing`,
    });
  }

  for (const [propName, propSchema] of Object.entries(properties)) {
    const wrongVal = generateNegativeValue(propSchema);
    if (wrongVal !== null || required.includes(propName)) {
      const args = { ...buildBaseArgs(properties, required), [propName]: wrongVal };
      tests.push({
        name: `${toolName}-negative-wrong-type-${propName}`,
        tool: toolName,
        args,
        category: 'negative',
        description: `Call ${toolName} with wrong type for ${propName}`,
      });
    }
  }

  for (const reqProp of required) {
    const args = { ...buildBaseArgs(properties, required), [reqProp]: null };
    tests.push({
      name: `${toolName}-negative-null-${reqProp}`,
      tool: toolName,
      args,
      category: 'negative',
      description: `Call ${toolName} with null for required field ${reqProp}`,
    });
  }

  return tests;
}
