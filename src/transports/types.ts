import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export type TransportType = 'stdio' | 'http' | 'sse' | 'streamable-http';

export interface TransportConfig {
  type: TransportType;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  isolateEnv?: boolean;
}

export type { Transport };
