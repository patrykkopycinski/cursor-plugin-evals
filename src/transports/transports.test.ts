import { describe, it, expect, vi } from 'vitest';
import type { TransportConfig } from './types.js';
import { createTransport } from './index.js';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioTransport {
    config: unknown;
    constructor(config: unknown) { this.config = config; }
    async start() {}
    async close() {}
    async send() {}
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableTransport {
    url: URL;
    opts: unknown;
    constructor(url: URL, opts?: unknown) { this.url = url; this.opts = opts; }
    async start() {}
    async close() {}
    async send() {}
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class MockSseTransport {
    url: URL;
    opts: unknown;
    constructor(url: URL, opts?: unknown) { this.url = url; this.opts = opts; }
    async start() {}
    async close() {}
    async send() {}
  },
}));

describe('createTransport factory', () => {
  it('creates stdio transport for type "stdio"', () => {
    const config: TransportConfig = {
      type: 'stdio',
      command: 'node',
      args: ['dist/index.js'],
      cwd: '/test/dir',
    };

    const transport = createTransport(config);
    expect(transport).toBeDefined();
    expect((transport as unknown as { config: unknown }).config).toMatchObject({
      command: 'node',
      args: ['dist/index.js'],
      cwd: '/test/dir',
      stderr: 'pipe',
    });
  });

  it('creates http transport for type "http"', () => {
    const config: TransportConfig = {
      type: 'http',
      url: 'http://localhost:3000/mcp',
    };

    const transport = createTransport(config);
    expect(transport).toBeDefined();
    expect((transport as unknown as { url: URL }).url.toString()).toBe(
      'http://localhost:3000/mcp',
    );
  });

  it('creates sse transport for type "sse"', () => {
    const config: TransportConfig = {
      type: 'sse',
      url: 'http://localhost:3000/sse',
    };

    const transport = createTransport(config);
    expect(transport).toBeDefined();
    expect((transport as unknown as { url: URL }).url.toString()).toBe(
      'http://localhost:3000/sse',
    );
  });

  it('creates streamable-http transport for type "streamable-http"', () => {
    const config: TransportConfig = {
      type: 'streamable-http',
      url: 'http://localhost:3000/mcp',
    };

    const transport = createTransport(config);
    expect(transport).toBeDefined();
    expect((transport as unknown as { url: URL }).url.toString()).toBe(
      'http://localhost:3000/mcp',
    );
  });

  it('throws for unsupported transport type', () => {
    const config = {
      type: 'websocket' as TransportConfig['type'],
    };

    expect(() => createTransport(config)).toThrow('Unsupported transport type');
  });
});

describe('stdio transport', () => {
  it('throws when command is missing', () => {
    const config: TransportConfig = { type: 'stdio' };
    expect(() => createTransport(config)).toThrow(
      'stdio transport requires a "command" field',
    );
  });

  it('merges process env with config env', () => {
    process.env.__TEST_TRANSPORT_VAR__ = 'existing';

    const config: TransportConfig = {
      type: 'stdio',
      command: 'node',
      env: { CUSTOM_VAR: 'custom' },
    };

    const transport = createTransport(config);
    const envField = (transport as unknown as { config: { env: Record<string, string> } }).config.env;
    expect(envField.CUSTOM_VAR).toBe('custom');
    expect(envField.__TEST_TRANSPORT_VAR__).toBe('existing');

    delete process.env.__TEST_TRANSPORT_VAR__;
  });
});

describe('http transport', () => {
  it('throws when url is missing', () => {
    const config: TransportConfig = { type: 'http' };
    expect(() => createTransport(config)).toThrow(
      'http transport requires a "url" field',
    );
  });

  it('passes headers via requestInit', () => {
    const config: TransportConfig = {
      type: 'http',
      url: 'http://localhost:3000/mcp',
      headers: { Authorization: 'Bearer token123' },
    };

    const transport = createTransport(config);
    const opts = (transport as unknown as { opts: { requestInit: RequestInit } }).opts;
    expect((opts.requestInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer token123',
    );
  });
});

describe('sse transport', () => {
  it('throws when url is missing', () => {
    const config: TransportConfig = { type: 'sse' };
    expect(() => createTransport(config)).toThrow(
      'sse transport requires a "url" field',
    );
  });
});

describe('streamable-http transport', () => {
  it('throws when url is missing', () => {
    const config: TransportConfig = { type: 'streamable-http' };
    expect(() => createTransport(config)).toThrow(
      'streamable-http transport requires a "url" field',
    );
  });
});

describe('backwards compatibility', () => {
  it('defaults to stdio when no type is explicitly provided via the factory', () => {
    const config: TransportConfig = {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    };

    const transport = createTransport(config);
    expect(transport).toBeDefined();
    expect((transport as unknown as { config: unknown }).config).toMatchObject({
      command: 'node',
      args: ['server.js'],
    });
  });
});
