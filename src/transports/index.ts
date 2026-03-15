import type { TransportConfig, TransportType } from './types.js';
import { createStdioTransport } from './stdio.js';
import { createHttpTransport } from './http.js';
import { createSseTransport } from './sse.js';
import { createStreamableHttpTransport } from './streamable-http.js';

export function createTransport(config: TransportConfig) {
  const type: TransportType = config.type;

  switch (type) {
    case 'stdio':
      return createStdioTransport(config);
    case 'http':
      return createHttpTransport(config);
    case 'sse':
      return createSseTransport(config);
    case 'streamable-http':
      return createStreamableHttpTransport(config);
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unsupported transport type: ${_exhaustive}`);
    }
  }
}

export type { TransportConfig, TransportType };
export { createStdioTransport } from './stdio.js';
export { createHttpTransport } from './http.js';
export { createSseTransport } from './sse.js';
export { createStreamableHttpTransport } from './streamable-http.js';
