/**
 * Plugin manifest and MCP-specific types.
 * These types are tied to the Cursor/MCP plugin ecosystem.
 */

import type { JsonSchema } from './common.js';

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface OpenAIFunctionDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: JsonSchema;
  };
}

export interface SkillComponent {
  name: string;
  description: string;
  path: string;
  body: string;
  license?: string;
}

export interface RuleComponent {
  description: string;
  alwaysApply?: boolean;
  globs?: string | string[];
  path: string;
  body: string;
}

export interface AgentComponent {
  name: string;
  description: string;
  model?: string;
  isBackground?: boolean;
  readonly?: boolean;
  path: string;
  body: string;
}

export interface CommandComponent {
  name?: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string | string[];
  disableModelInvocation?: boolean;
  path: string;
  body: string;
}

export interface HookHandler {
  command: string;
  matcher?: string;
  async?: boolean;
}

export interface HookComponent {
  event: string;
  handlers: HookHandler[];
}

export interface McpServerComponent {
  name: string;
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface PluginManifest {
  name: string;
  description?: string;
  version?: string;
  dir: string;
  skills: SkillComponent[];
  rules: RuleComponent[];
  agents: AgentComponent[];
  commands: CommandComponent[];
  hooks: HookComponent[];
  mcpServers: McpServerComponent[];
}
