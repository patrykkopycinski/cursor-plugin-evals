import type { McpToolDefinition, OpenAIFunctionDefinition, JsonSchema } from '../core/types.js';

/**
 * Deep-clone a JsonSchema node, preserving only the properties
 * relevant to OpenAI function-calling parameter schemas.
 */
function convertSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};

  if (schema.type !== undefined) out.type = schema.type;
  if (schema.description !== undefined) out.description = schema.description;
  if (schema.enum !== undefined) out.enum = schema.enum;
  if (schema.default !== undefined) out.default = schema.default;
  if (schema.additionalProperties !== undefined) {
    out.additionalProperties =
      typeof schema.additionalProperties === 'object'
        ? convertSchema(schema.additionalProperties)
        : schema.additionalProperties;
  }

  if (schema.properties) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      out.properties[key] = convertSchema(value);
    }
  }

  if (schema.required && schema.required.length > 0) {
    out.required = [...schema.required];
  }

  if (schema.items) {
    out.items = convertSchema(schema.items);
  }

  if (schema.oneOf) {
    out.oneOf = schema.oneOf.map(convertSchema);
  }
  if (schema.anyOf) {
    out.anyOf = schema.anyOf.map(convertSchema);
  }
  if (schema.allOf) {
    out.allOf = schema.allOf.map(convertSchema);
  }

  return out;
}

function toOpenAI(tool: McpToolDefinition): OpenAIFunctionDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      ...(tool.description !== undefined && { description: tool.description }),
      parameters: convertSchema(tool.inputSchema),
    },
  };
}

/**
 * Convert MCP tool definitions to a Record keyed by tool name.
 * An optional allowlist restricts the output to only the named tools.
 */
export function convertTools(
  tools: McpToolDefinition[],
  allowlist?: string[],
): Record<string, OpenAIFunctionDefinition> {
  const filter = allowlist && allowlist.length > 0 ? new Set(allowlist) : undefined;

  const result: Record<string, OpenAIFunctionDefinition> = {};

  for (const tool of tools) {
    if (filter && !filter.has(tool.name)) continue;
    result[tool.name] = toOpenAI(tool);
  }

  return result;
}

/**
 * Convert MCP tool definitions to an array of OpenAI function definitions.
 * An optional allowlist restricts the output to only the named tools.
 */
export function convertToolsToArray(
  tools: McpToolDefinition[],
  allowlist?: string[],
): OpenAIFunctionDefinition[] {
  return Object.values(convertTools(tools, allowlist));
}
