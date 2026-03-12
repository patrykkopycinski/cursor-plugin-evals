import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { TransportConfig } from './types.js';

export function createStreamableHttpTransport(config: TransportConfig): Transport {
  if (!config.url) {
    throw new Error('streamable-http transport requires a "url" field');
  }

  const url = new URL(config.url);

  const requestInit: RequestInit = {};
  if (config.headers && Object.keys(config.headers).length > 0) {
    requestInit.headers = config.headers;
  }

  return new StreamableHTTPClientTransport(url, {
    requestInit,
    reconnectionOptions: {
      maxReconnectionDelay: 30_000,
      initialReconnectionDelay: 1_000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 3,
    },
  });
}
