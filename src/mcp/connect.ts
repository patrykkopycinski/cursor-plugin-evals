import type { PluginConfig } from '../core/types.js';
import type { McpConnectConfig } from './client.js';
import { parseEntry } from '../core/utils.js';

/**
 * Build an MCP connection config from a plugin definition.
 *
 * This bridges the generic PluginConfig (core) with the MCP-specific
 * McpConnectConfig. It lives in `mcp/` rather than `core/` so that
 * the core module doesn't depend on MCP types.
 */
export function buildConnectConfig(plugin: PluginConfig): McpConnectConfig {
  const config: McpConnectConfig = {
    buildCommand: plugin.buildCommand,
    env: plugin.env,
  };

  if (plugin.transport && plugin.transport !== 'stdio') {
    config.transport = {
      type: plugin.transport,
      url: plugin.url,
      headers: plugin.headers,
    };
  } else if (plugin.entry) {
    const { command, args } = parseEntry(plugin.entry);
    config.command = command;
    config.args = args;
    config.cwd = plugin.dir;
  }

  return config;
}
