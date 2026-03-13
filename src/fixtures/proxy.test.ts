import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpFixtureProxy } from './proxy.js';
import type { ToolResult } from '../core/types.js';
import type { McpPluginClient } from '../mcp/client.js';
import type { FixtureMatch } from './responder.js';

vi.mock('./responder.js', () => {
  const MockResponder = vi.fn(function (this: Record<string, unknown>) {
    this.load = vi.fn().mockResolvedValue(undefined);
    this.respond = vi.fn().mockReturnValue(null);
  });
  return { McpFixtureResponder: MockResponder };
});

vi.mock('./recorder.js', () => {
  const MockRecorder = vi.fn(function (this: Record<string, unknown>) {
    this.record = vi.fn();
    this.flush = vi.fn().mockResolvedValue(undefined);
  });
  return { McpFixtureRecorder: MockRecorder };
});

import { McpFixtureResponder } from './responder.js';

function makeResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function mockClient(result: ToolResult): McpPluginClient {
  return { callTool: vi.fn().mockResolvedValue(result) } as unknown as McpPluginClient;
}

function getResponder(): { load: ReturnType<typeof vi.fn>; respond: ReturnType<typeof vi.fn> } {
  const instances = vi.mocked(McpFixtureResponder).mock.instances;
  return instances[instances.length - 1] as unknown as ReturnType<typeof getResponder>;
}

describe('McpFixtureProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mock mode', () => {
    it('returns fixture on hit', async () => {
      const proxy = new McpFixtureProxy({ mode: 'mock', fixtureDir: '/fixtures' });
      await proxy.init();

      const fixtureResult = makeResult('fixture data');
      getResponder().respond.mockReturnValue({
        result: fixtureResult,
        matchType: 'exact',
        latencyMs: 10,
      } satisfies FixtureMatch);

      const response = await proxy.handle('test_tool', { q: 'hello' });

      expect(response.result).toBe(fixtureResult);
      expect(response.source).toBe('fixture');
      expect(response.matchType).toBe('exact');
    });

    it('returns error on miss', async () => {
      const proxy = new McpFixtureProxy({ mode: 'mock', fixtureDir: '/fixtures' });
      await proxy.init();

      getResponder().respond.mockReturnValue(null);

      const response = await proxy.handle('test_tool', { q: 'unknown' });

      expect(response.result.isError).toBe(true);
      expect(response.source).toBe('fixture');
      expect(response.matchType).toBe('miss');
    });
  });

  describe('passthrough mode', () => {
    it('always uses live client', async () => {
      const liveResult = makeResult('live response');
      const client = mockClient(liveResult);

      const proxy = new McpFixtureProxy({
        mode: 'passthrough',
        fixtureDir: '/fixtures',
        fallbackClient: client,
      });
      await proxy.init();

      const response = await proxy.handle('test_tool', { q: 'hello' });

      expect(response.result).toBe(liveResult);
      expect(response.source).toBe('live');
      expect(client.callTool).toHaveBeenCalledWith('test_tool', { q: 'hello' });
    });

    it('does not load fixtures', async () => {
      const client = mockClient(makeResult('ok'));
      const proxy = new McpFixtureProxy({
        mode: 'passthrough',
        fixtureDir: '/fixtures',
        fallbackClient: client,
      });
      await proxy.init();

      expect(getResponder().load).not.toHaveBeenCalled();
    });
  });

  describe('hybrid mode', () => {
    it('returns fixture when available', async () => {
      const client = mockClient(makeResult('live'));
      const fixtureResult = makeResult('cached');

      const proxy = new McpFixtureProxy({
        mode: 'hybrid',
        fixtureDir: '/fixtures',
        fallbackClient: client,
      });
      await proxy.init();

      getResponder().respond.mockReturnValue({
        result: fixtureResult,
        matchType: 'exact',
        latencyMs: 5,
      } satisfies FixtureMatch);

      const response = await proxy.handle('test_tool', { q: 'hello' });

      expect(response.result).toBe(fixtureResult);
      expect(response.source).toBe('fixture');
      expect(client.callTool).not.toHaveBeenCalled();
    });

    it('falls back to live on fixture miss', async () => {
      const liveResult = makeResult('from server');
      const client = mockClient(liveResult);

      const proxy = new McpFixtureProxy({
        mode: 'hybrid',
        fixtureDir: '/fixtures',
        fallbackClient: client,
      });
      await proxy.init();

      getResponder().respond.mockReturnValue(null);

      const response = await proxy.handle('test_tool', { q: 'new' });

      expect(response.result).toBe(liveResult);
      expect(response.source).toBe('live');
      expect(response.matchType).toBe('miss');
    });

    it('returns error on miss without fallback client', async () => {
      const proxy = new McpFixtureProxy({
        mode: 'hybrid',
        fixtureDir: '/fixtures',
      });
      await proxy.init();

      getResponder().respond.mockReturnValue(null);

      const response = await proxy.handle('test_tool', {});

      expect(response.result.isError).toBe(true);
      expect(response.matchType).toBe('miss');
    });
  });

  describe('comparison mode', () => {
    it('detects matching responses', async () => {
      const fixtureResult = makeResult('hello world');
      const liveResult = makeResult('hello world');
      const client = mockClient(liveResult);

      const proxy = new McpFixtureProxy({
        mode: 'hybrid',
        fixtureDir: '/fixtures',
        fallbackClient: client,
        compareResponses: true,
      });
      await proxy.init();

      getResponder().respond.mockReturnValue({
        result: fixtureResult,
        matchType: 'exact',
        latencyMs: 5,
      } satisfies FixtureMatch);

      const response = await proxy.handle('test_tool', { q: 'test' });

      expect(response.comparison).toBeDefined();
      expect(response.comparison!.match).toBe(true);
      expect(response.comparison!.differences).toHaveLength(0);
      expect(response.source).toBe('live');
    });

    it('detects differences between fixture and live', async () => {
      const fixtureResult = makeResult('line1\nline2\nline3');
      const liveResult = makeResult('line1\nchanged\nline3');
      const client = mockClient(liveResult);

      const proxy = new McpFixtureProxy({
        mode: 'hybrid',
        fixtureDir: '/fixtures',
        fallbackClient: client,
        compareResponses: true,
      });
      await proxy.init();

      getResponder().respond.mockReturnValue({
        result: fixtureResult,
        matchType: 'exact',
        latencyMs: 5,
      } satisfies FixtureMatch);

      const response = await proxy.handle('test_tool', { q: 'test' });

      expect(response.comparison).toBeDefined();
      expect(response.comparison!.match).toBe(false);
      expect(response.comparison!.differences.length).toBeGreaterThan(0);
    });

    it('detects isError mismatch', async () => {
      const fixtureResult = makeResult('ok', false);
      const liveResult = makeResult('error', true);
      const client = mockClient(liveResult);

      const proxy = new McpFixtureProxy({
        mode: 'hybrid',
        fixtureDir: '/fixtures',
        fallbackClient: client,
        compareResponses: true,
      });
      await proxy.init();

      getResponder().respond.mockReturnValue({
        result: fixtureResult,
        matchType: 'exact',
        latencyMs: 5,
      } satisfies FixtureMatch);

      const response = await proxy.handle('test_tool', {});

      expect(response.comparison!.match).toBe(false);
      expect(response.comparison!.differences.some((d) => d.includes('isError'))).toBe(true);
    });
  });

  describe('stats tracking', () => {
    it('tracks hits and misses', async () => {
      const client = mockClient(makeResult('live'));

      const proxy = new McpFixtureProxy({
        mode: 'hybrid',
        fixtureDir: '/fixtures',
        fallbackClient: client,
      });
      await proxy.init();

      const fixtureResult = makeResult('cached');
      getResponder().respond.mockReturnValueOnce({
        result: fixtureResult,
        matchType: 'exact',
        latencyMs: 5,
      } satisfies FixtureMatch);
      await proxy.handle('tool_a', {});

      getResponder().respond.mockReturnValueOnce(null);
      await proxy.handle('tool_b', {});

      getResponder().respond.mockReturnValueOnce({
        result: fixtureResult,
        matchType: 'fuzzy',
        latencyMs: 5,
      } satisfies FixtureMatch);
      await proxy.handle('tool_c', {});

      const stats = proxy.getStats();
      expect(stats.fixtureHits).toBe(2);
      expect(stats.fixtureMisses).toBe(1);
      expect(stats.liveRequests).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
    });

    it('tracks comparison matches', async () => {
      const fixtureResult = makeResult('same');
      const client = mockClient(makeResult('same'));

      const proxy = new McpFixtureProxy({
        mode: 'hybrid',
        fixtureDir: '/fixtures',
        fallbackClient: client,
        compareResponses: true,
      });
      await proxy.init();

      getResponder().respond.mockReturnValue({
        result: fixtureResult,
        matchType: 'exact',
        latencyMs: 5,
      } satisfies FixtureMatch);

      await proxy.handle('tool', {});
      await proxy.handle('tool', {});

      const stats = proxy.getStats();
      expect(stats.comparisons).toBe(2);
      expect(stats.comparisonMatches).toBe(2);
    });

    it('returns zero hit rate when no requests', () => {
      const proxy = new McpFixtureProxy({ mode: 'mock', fixtureDir: '/fixtures' });
      const stats = proxy.getStats();
      expect(stats.hitRate).toBe(0);
    });
  });
});
