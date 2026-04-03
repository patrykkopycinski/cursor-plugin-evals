import { describe, it, expect } from 'vitest';
import { buildConnectConfig } from './connect.js';
import type { PluginConfig } from '../core/types.js';

function makePlugin(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    name: 'test-plugin',
    dir: '/tmp/test-plugin',
    ...overrides,
  };
}

describe('buildConnectConfig', () => {
  it('builds a stdio config from entry', () => {
    const config = buildConnectConfig(makePlugin({ entry: 'node dist/index.js --verbose' }));
    expect(config.command).toBe('node');
    expect(config.args).toEqual(['dist/index.js', '--verbose']);
    expect(config.cwd).toBe('/tmp/test-plugin');
  });

  it('sets buildCommand and env from plugin', () => {
    const config = buildConnectConfig(
      makePlugin({
        entry: 'node index.js',
        buildCommand: 'npm run build',
        env: { FOO: 'bar' },
      }),
    );
    expect(config.buildCommand).toBe('npm run build');
    expect(config.env).toEqual({ FOO: 'bar' });
  });

  it('builds a transport config for non-stdio transport', () => {
    const config = buildConnectConfig(
      makePlugin({
        transport: 'sse',
        url: 'http://localhost:3000/sse',
        headers: { Authorization: 'Bearer token' },
      }),
    );
    expect(config.transport).toEqual({
      type: 'sse',
      url: 'http://localhost:3000/sse',
      headers: { Authorization: 'Bearer token' },
    });
    expect(config.command).toBeUndefined();
  });

  it('prefers transport over entry when transport is non-stdio', () => {
    const config = buildConnectConfig(
      makePlugin({
        entry: 'node index.js',
        transport: 'streamable-http',
        url: 'http://localhost:3000/mcp',
      }),
    );
    expect(config.transport).toBeDefined();
    expect(config.command).toBeUndefined();
  });

  it('falls back to entry when transport is "stdio"', () => {
    const config = buildConnectConfig(
      makePlugin({
        entry: 'python server.py',
        transport: 'stdio',
      }),
    );
    expect(config.transport).toBeUndefined();
    expect(config.command).toBe('python');
    expect(config.args).toEqual(['server.py']);
  });

  it('returns minimal config when neither entry nor transport is set', () => {
    const config = buildConnectConfig(makePlugin());
    expect(config.command).toBeUndefined();
    expect(config.transport).toBeUndefined();
    expect(config.buildCommand).toBeUndefined();
  });
});
