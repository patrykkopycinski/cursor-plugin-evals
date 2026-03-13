import { execSync } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { TransportConfig } from '../transports/types.js';
import { createTransport } from '../transports/index.js';
import type { ToolResult, McpToolDefinition, McpResource, JsonSchema } from '../core/types.js';

export interface McpConnectConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  buildCommand?: string;
  timeout?: number;
  callTimeout?: number;
  transport?: TransportConfig;
}

const DEFAULT_CONNECT_TIMEOUT = 30_000;
const DEFAULT_CALL_TIMEOUT = 30_000;
const DISCONNECT_GRACE_MS = 5_000;

type ConnectionState = 'disconnected' | 'connected';

export class McpPluginClient {
  private client: Client;
  private transport: Transport;
  private state: ConnectionState = 'connected';
  private callTimeout: number;
  private disconnecting = false;

  private constructor(client: Client, transport: Transport, callTimeout: number) {
    this.client = client;
    this.transport = transport;
    this.callTimeout = callTimeout;

    this.transport.onclose = () => {
      this.state = 'disconnected';
    };
  }

  static async connect(config: McpConnectConfig): Promise<McpPluginClient> {
    const timeout = config.timeout ?? DEFAULT_CONNECT_TIMEOUT;
    const callTimeout = config.callTimeout ?? DEFAULT_CALL_TIMEOUT;

    if (config.buildCommand) {
      try {
        execSync(config.buildCommand, {
          cwd: config.cwd,
          stdio: 'pipe',
          timeout,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Build command failed: ${msg}`);
      }
    }

    const transportConfig: TransportConfig = config.transport ?? {
      type: 'stdio',
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
    };

    if (transportConfig.type === 'stdio' && !transportConfig.command && config.command) {
      transportConfig.command = config.command;
      transportConfig.args = transportConfig.args ?? config.args;
      transportConfig.cwd = transportConfig.cwd ?? config.cwd;
      transportConfig.env = transportConfig.env ?? config.env;
    }

    const transport = createTransport(transportConfig);

    const client = new Client({ name: 'cursor-plugin-evals', version: '0.1.0' });

    try {
      await client.connect(transport, { timeout });
    } catch (err) {
      await transport.close().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`MCP initialization failed: ${msg}`);
    }

    return new McpPluginClient(client, transport, callTimeout);
  }

  private assertConnected(): void {
    if (this.state === 'disconnected') {
      throw new Error('MCP client is disconnected');
    }
  }

  async listTools(): Promise<McpToolDefinition[]> {
    this.assertConnected();

    const response = await this.client.listTools(undefined, {
      timeout: this.callTimeout,
    });

    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as unknown as JsonSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    this.assertConnected();

    const response = await this.client.callTool({ name, arguments: args }, undefined, {
      timeout: this.callTimeout,
    });

    if ('toolResult' in response) {
      return {
        content: [{ type: 'text', text: JSON.stringify(response.toolResult) }],
        isError: false,
      };
    }

    return {
      content: response.content.map((item) => {
        if (item.type === 'text') {
          return { type: 'text', text: item.text };
        }
        if (item.type === 'image' || item.type === 'audio') {
          return { type: item.type, blob: item.data };
        }
        if (item.type === 'resource') {
          const r = item.resource;
          return 'text' in r ? { type: 'text', text: r.text } : { type: 'resource', blob: r.blob };
        }
        return { type: item.type, text: JSON.stringify(item) };
      }),
      isError: response.isError ?? false,
    };
  }

  async listResources(): Promise<McpResource[]> {
    this.assertConnected();

    const response = await this.client.listResources(undefined, {
      timeout: this.callTimeout,
    });

    return response.resources.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  }

  async readResource(
    uri: string,
  ): Promise<{
    contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
  }> {
    this.assertConnected();

    const response = await this.client.readResource({ uri }, { timeout: this.callTimeout });

    return {
      contents: response.contents.map((c) => ({
        uri: c.uri,
        mimeType: c.mimeType,
        ...('text' in c ? { text: c.text } : { blob: c.blob }),
      })),
    };
  }

  async disconnect(): Promise<void> {
    if (this.state === 'disconnected' || this.disconnecting) {
      return;
    }

    this.disconnecting = true;

    try {
      const pid = (this.transport as StdioClientTransport).pid;

      const closePromise = this.client.close();

      const killTimer = pid
        ? setTimeout(() => {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              // Process already exited
            }
          }, DISCONNECT_GRACE_MS)
        : undefined;

      try {
        await closePromise;
      } finally {
        if (killTimer) clearTimeout(killTimer);
      }
    } finally {
      this.state = 'disconnected';
      this.disconnecting = false;
    }
  }

  get connected(): boolean {
    return this.state === 'connected';
  }

  get rawClient(): Client {
    return this.client;
  }
}
