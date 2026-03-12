import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { TransportConfig } from './types.js';

export function createSseTransport(config: TransportConfig): Transport {
  if (!config.url) {
    throw new Error('sse transport requires a "url" field');
  }

  const url = new URL(config.url);

  const requestInit: RequestInit = {};
  if (config.headers && Object.keys(config.headers).length > 0) {
    requestInit.headers = config.headers;
  }

  const eventSourceInit: EventSourceInit = {};
  if (config.headers && Object.keys(config.headers).length > 0) {
    (eventSourceInit as Record<string, unknown>).headers = config.headers;
  }

  return new SSEClientTransport(url, { requestInit, eventSourceInit });
}
