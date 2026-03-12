import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { TransportConfig } from './types.js';

export function createStdioTransport(config: TransportConfig): Transport {
  if (!config.command) {
    throw new Error('stdio transport requires a "command" field');
  }

  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) cleanEnv[k] = v;
  }

  const mergedEnv: Record<string, string> = { ...cleanEnv, ...config.env };

  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    env: mergedEnv,
    stderr: 'pipe',
  });
}
