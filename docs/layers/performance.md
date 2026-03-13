# Performance Layer

Measure tool call latency, throughput, memory usage, and enforce percentile-based thresholds.

## What It Measures

Each performance test calls a tool repeatedly and collects timing data:

| Metric | Description |
|--------|-------------|
| `p50` | Median latency (ms) |
| `p95` | 95th percentile latency (ms) |
| `p99` | 99th percentile latency (ms) |
| `mean` | Average latency (ms) |
| `min` / `max` | Fastest and slowest calls (ms) |
| `throughput` | Calls per second |
| `memoryDelta` | Heap memory change (bytes) from before to after |
| `samples` | Number of measured iterations |

## YAML Config

```yaml
suites:
  - name: perf-benchmarks
    layer: performance
    tests:
      - name: search-latency
        tool: elasticsearch_api
        args:
          method: GET
          path: /my-index/_search
          body: '{"query":{"match_all":{}}}'
        warmup: 3
        iterations: 50
        thresholds:
          p50: 200
          p95: 500
          p99: 1000

      - name: concurrent-load
        tool: elasticsearch_api
        args:
          method: GET
          path: /_cat/indices
        iterations: 100
        concurrency: 10
        thresholds:
          p95: 1000
```

## Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tool` | string | *required* | Tool name to call |
| `args` | object | *required* | Tool arguments |
| `warmup` | number | `0` | Warm-up iterations (excluded from measurements) |
| `iterations` | number | `10` | Measured iterations |
| `concurrency` | number | `1` | Parallel calls per iteration batch |
| `thresholds` | object | — | Max allowed latency per percentile (ms) |

## Warmup

Warmup iterations execute the tool call but discard the timing data. This accounts for JIT compilation, connection pooling, and cold cache effects:

```yaml
        warmup: 5
        iterations: 100
```

The first 5 calls are discarded; only the remaining 100 are measured.

## Concurrent Load Testing

Set `concurrency` to run multiple tool calls in parallel per batch. With `iterations: 100` and `concurrency: 10`, each batch fires 10 parallel calls, repeated 10 times (100 total calls):

```yaml
        iterations: 100
        concurrency: 10
```

This tests how the server handles load and helps identify contention issues.

## Memory Tracking

The framework captures Node.js heap usage before and after the test. The `memoryDelta` metric shows the difference. Large positive deltas may indicate memory leaks in the server.

## Threshold Gating

Tests fail when any percentile exceeds its threshold:

```yaml
        thresholds:
          p50: 100    # median must be under 100ms
          p95: 500    # 95th percentile under 500ms
          p99: 2000   # 99th percentile under 2000ms
```

In CI mode (`--ci`), threshold violations cause a non-zero exit code.

## CLI Usage

```bash
# Run performance tests
cursor-plugin-evals run -l performance

# Run with more iterations for stable measurements
cursor-plugin-evals run -l performance -r 5
```

## Report Output

The terminal report includes a performance summary:

```
Suite: perf-benchmarks (performance)
  ✅ search-latency
     p50: 45ms  p95: 120ms  p99: 180ms  throughput: 22.1/s  memory: +1.2MB
  ❌ concurrent-load
     p50: 200ms  p95: 1200ms (threshold: 1000ms)  p99: 2100ms
```

## See Also

- [Integration Layer](./integration.md)
- [CI/CD Integration](../ci-cd.md)
- [Configuration Reference](../configuration.md)
