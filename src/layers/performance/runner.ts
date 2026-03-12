import pLimit from 'p-limit';
import type { TestResult, SuiteConfig, DefaultsConfig } from '../../core/types.js';
import type { McpPluginClient } from '../../mcp/client.js';
import type { PerformanceTestConfig, PerformanceMetrics } from './types.js';
import { DEFAULT_WARMUP, DEFAULT_ITERATIONS, DEFAULT_CONCURRENCY } from './types.js';
import { mergeDefaults } from '../../core/utils.js';
import { log } from '../../cli/logger.js';

export function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function computeMetrics(latencies: number[], durationMs: number, memoryDelta: number): PerformanceMetrics {
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    p50: computePercentile(sorted, 50),
    p95: computePercentile(sorted, 95),
    p99: computePercentile(sorted, 99),
    mean: sorted.length > 0 ? sum / sorted.length : 0,
    min: sorted.length > 0 ? sorted[0] : 0,
    max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    throughput: durationMs > 0 ? (sorted.length / durationMs) * 1000 : 0,
    memoryDelta,
    samples: sorted.length,
  };
}

function checkThresholds(
  metrics: PerformanceMetrics,
  thresholds?: PerformanceTestConfig['thresholds'],
): { pass: boolean; violations: string[] } {
  if (!thresholds) return { pass: true, violations: [] };

  const violations: string[] = [];

  if (thresholds.p50 !== undefined && metrics.p50 > thresholds.p50) {
    violations.push(`p50 ${metrics.p50.toFixed(1)}ms > ${thresholds.p50}ms`);
  }
  if (thresholds.p95 !== undefined && metrics.p95 > thresholds.p95) {
    violations.push(`p95 ${metrics.p95.toFixed(1)}ms > ${thresholds.p95}ms`);
  }
  if (thresholds.p99 !== undefined && metrics.p99 > thresholds.p99) {
    violations.push(`p99 ${metrics.p99.toFixed(1)}ms > ${thresholds.p99}ms`);
  }

  return { pass: violations.length === 0, violations };
}

async function runSinglePerformanceTest(
  test: PerformanceTestConfig,
  suiteName: string,
  client: McpPluginClient,
): Promise<TestResult> {
  const warmup = test.warmup ?? DEFAULT_WARMUP;
  const iterations = test.iterations ?? DEFAULT_ITERATIONS;
  const concurrency = test.concurrency ?? DEFAULT_CONCURRENCY;

  try {
    for (let i = 0; i < warmup; i++) {
      await client.callTool(test.tool, test.args);
    }

    const heapBefore = process.memoryUsage().heapUsed;
    const limit = pLimit(concurrency);
    const latencies: number[] = [];

    const benchStart = performance.now();

    await Promise.all(
      Array.from({ length: iterations }, () =>
        limit(async () => {
          const start = performance.now();
          await client.callTool(test.tool, test.args);
          latencies.push(performance.now() - start);
        }),
      ),
    );

    const benchDuration = performance.now() - benchStart;
    const heapAfter = process.memoryUsage().heapUsed;
    const memoryDelta = heapAfter - heapBefore;

    const metrics = computeMetrics(latencies, benchDuration, memoryDelta);
    const { pass, violations } = checkThresholds(metrics, test.thresholds);

    return {
      name: test.name,
      suite: suiteName,
      layer: 'performance',
      pass,
      toolCalls: [],
      evaluatorResults: [],
      latencyMs: benchDuration,
      performanceMetrics: metrics,
      error: violations.length > 0 ? `Threshold violations: ${violations.join(', ')}` : undefined,
    };
  } catch (err) {
    return {
      name: test.name,
      suite: suiteName,
      layer: 'performance',
      pass: false,
      toolCalls: [],
      evaluatorResults: [],
      latencyMs: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runPerformanceSuite(
  suite: SuiteConfig,
  client: McpPluginClient,
  defaults: DefaultsConfig,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const mergedDefaults: DefaultsConfig = mergeDefaults(suite.defaults, defaults);

  for (const test of suite.tests) {
    const perfTest = test as unknown as PerformanceTestConfig;
    log.test(perfTest.name, 'running');
    const result = await runSinglePerformanceTest(perfTest, suite.name, client);
    log.test(perfTest.name, result.pass ? 'pass' : 'fail');

    if (!result.pass && result.error) {
      log.debug(result.error);
    }

    if (result.performanceMetrics) {
      const m = result.performanceMetrics;
      log.debug(
        `  p50=${m.p50.toFixed(1)}ms p95=${m.p95.toFixed(1)}ms p99=${m.p99.toFixed(1)}ms ` +
        `throughput=${m.throughput.toFixed(1)}/s samples=${m.samples}`,
      );
    }

    results.push(result);
  }

  return results;
}
