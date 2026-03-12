import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpToolDefinition, McpResource, JsonSchema } from '../core/types.js';

export type McpPluginClient = Pick<Client, 'listTools' | 'listResources'>;

/**
 * Discover all tools registered on the MCP server and return them as a
 * typed catalog conforming to the project's `McpToolDefinition` shape.
 */
export async function discoverTools(
  client: McpPluginClient,
): Promise<McpToolDefinition[]> {
  const response = await client.listTools();

  return response.tools.map((tool) => ({
    name: tool.name,
    ...(tool.description !== undefined && { description: tool.description }),
    inputSchema: tool.inputSchema as JsonSchema,
  }));
}

/**
 * Discover all resources exposed by the MCP server and return them as a
 * typed array conforming to the project's `McpResource` shape.
 */
export async function discoverResources(
  client: McpPluginClient,
): Promise<McpResource[]> {
  const response = await client.listResources();

  return response.resources.map((resource) => ({
    uri: resource.uri,
    name: resource.name,
    ...(resource.description !== undefined && {
      description: resource.description,
    }),
    ...(resource.mimeType !== undefined && { mimeType: resource.mimeType }),
  }));
}
