import { describe, it, expect, vi } from 'vitest';
import { computePercentile, runPerformanceSuite } from './runner.js';
import type { SuiteConfig } from '../../core/types.js';
import type { McpPluginClient } from '../../mcp/client.js';

describe('computePercentile', () => {
  it('returns 0 for empty array', () => {
    expect(computePercentile([], 50)).toBe(0);
  });

  it('returns the single value for a single-element array', () => {
    expect(computePercentile([42], 50)).toBe(42);
    expect(computePercentile([42], 99)).toBe(42);
  });

  it('computes p50 from sorted latencies', () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(computePercentile(sorted, 50)).toBe(30);
  });

  it('computes p95 from sorted latencies', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    const p95 = computePercentile(sorted, 95);
    expect(p95).toBeCloseTo(95.05, 1);
  });

  it('computes p99 from sorted latencies', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    const p99 = computePercentile(sorted, 99);
    expect(p99).toBeCloseTo(99.01, 1);
  });

  it('interpolates between two values', () => {
    const sorted = [10, 20];
    expect(computePercentile(sorted, 50)).toBe(15);
  });
});

function createMockClient(latencyMs = 1): McpPluginClient {
  return {
    callTool: vi.fn().mockImplementation(async () => {
      if (latencyMs > 0) {
        await new Promise((r) => setTimeout(r, latencyMs));
      }
      return { content: [{ type: 'text', text: 'ok' }], isError: false };
    }),
    disconnect: vi.fn(),
  } as unknown as McpPluginClient;
}

describe('runPerformanceSuite', () => {
  it('produces correct sample count with concurrency=1', async () => {
    const client = createMockClient(0);
    const suite: SuiteConfig = {
      name: 'perf-suite',
      layer: 'performance',
      tests: [
        {
          name: 'basic-test',
          tool: 'echo',
          args: { msg: 'hello' },
          warmup: 1,
          iterations: 10,
          concurrency: 1,
        } as unknown as SuiteConfig['tests'][0],
      ],
    };

    const results = await runPerformanceSuite(suite, client, {});

    expect(results).toHaveLength(1);
    expect(results[0].pass).toBe(true);
    expect(results[0].performanceMetrics).toBeDefined();
    expect(results[0].performanceMetrics!.samples).toBe(10);
    // warmup(1) + iterations(10)
    expect(client.callTool).toHaveBeenCalledTimes(11);
  });

  it('produces correct sample count with concurrency > 1', async () => {
    const client = createMockClient(0);
    const suite: SuiteConfig = {
      name: 'perf-suite',
      layer: 'performance',
      tests: [
        {
          name: 'concurrent-test',
          tool: 'echo',
          args: {},
          warmup: 2,
          iterations: 20,
          concurrency: 5,
        } as unknown as SuiteConfig['tests'][0],
      ],
    };

    const results = await runPerformanceSuite(suite, client, {});

    expect(results).toHaveLength(1);
    expect(results[0].performanceMetrics!.samples).toBe(20);
    // warmup(2) + iterations(20)
    expect(client.callTool).toHaveBeenCalledTimes(22);
  });

  it('passes when all thresholds are met', async () => {
    const client = createMockClient(0);
    const suite: SuiteConfig = {
      name: 'perf-suite',
      layer: 'performance',
      tests: [
        {
          name: 'threshold-pass',
          tool: 'fast-tool',
          args: {},
          warmup: 0,
          iterations: 5,
          thresholds: { p50: 5000, p95: 10000, p99: 15000 },
        } as unknown as SuiteConfig['tests'][0],
      ],
    };

    const results = await runPerformanceSuite(suite, client, {});
    expect(results[0].pass).toBe(true);
    expect(results[0].error).toBeUndefined();
  });

  it('fails when thresholds are violated', async () => {
    const client = createMockClient(50);
    const suite: SuiteConfig = {
      name: 'perf-suite',
      layer: 'performance',
      tests: [
        {
          name: 'threshold-fail',
          tool: 'slow-tool',
          args: {},
          warmup: 0,
          iterations: 5,
          concurrency: 1,
          thresholds: { p50: 1 },
        } as unknown as SuiteConfig['tests'][0],
      ],
    };

    const results = await runPerformanceSuite(suite, client, {});
    expect(results[0].pass).toBe(false);
    expect(results[0].error).toContain('Threshold violations');
    expect(results[0].error).toContain('p50');
  });

  it('handles tool call errors gracefully', async () => {
    const client = {
      callTool: vi.fn().mockRejectedValue(new Error('connection refused')),
      disconnect: vi.fn(),
    } as unknown as McpPluginClient;

    const suite: SuiteConfig = {
      name: 'perf-suite',
      layer: 'performance',
      tests: [
        {
          name: 'error-test',
          tool: 'broken-tool',
          args: {},
          warmup: 1,
          iterations: 5,
        } as unknown as SuiteConfig['tests'][0],
      ],
    };

    const results = await runPerformanceSuite(suite, client, {});
    expect(results[0].pass).toBe(false);
    expect(results[0].error).toContain('connection refused');
  });

  it('reports throughput > 0 for successful runs', async () => {
    const client = createMockClient(0);
    const suite: SuiteConfig = {
      name: 'perf-suite',
      layer: 'performance',
      tests: [
        {
          name: 'throughput-test',
          tool: 'echo',
          args: {},
          warmup: 0,
          iterations: 10,
        } as unknown as SuiteConfig['tests'][0],
      ],
    };

    const results = await runPerformanceSuite(suite, client, {});
    expect(results[0].performanceMetrics!.throughput).toBeGreaterThan(0);
  });

  it('uses default warmup/iterations/concurrency when not specified', async () => {
    const client = createMockClient(0);
    const suite: SuiteConfig = {
      name: 'perf-suite',
      layer: 'performance',
      tests: [
        {
          name: 'defaults-test',
          tool: 'echo',
          args: {},
        } as unknown as SuiteConfig['tests'][0],
      ],
    };

    const results = await runPerformanceSuite(suite, client, {});
    // Default: warmup=3, iterations=50
    expect(results[0].performanceMetrics!.samples).toBe(50);
    expect(client.callTool).toHaveBeenCalledTimes(53);
  });
});
