# Harvest Traces

Convert failed production traces from Elasticsearch into regression test cases. Turn real failures into automated tests.

## Usage

```bash
cursor-plugin-evals harvest \
  --endpoint https://my-cluster.es.io \
  --api-key $ES_API_KEY \
  --from now-24h \
  --score-threshold 0.5 \
  --max-tests 20 \
  -o harvested-tests.yaml
```

## How It Works

1. Queries ES for traces with low eval scores or failure status
2. Clusters failures by error type using `significant_terms` aggregation
3. Fetches full trace data for each failed trace
4. Extracts prompt, tool calls, and response from OTel attributes
5. Generates `plugin-eval.yaml` test definitions

## Output

```yaml
# Harvested regression tests
suites:
  - name: harvested-regressions
    layer: llm
    adapter: otel-trace
    tests:
      # Harvested from trace abc123 at 2026-03-30T12:00:00Z (score: 0.2)
      # Failure cluster: tool_timeout
      - name: harvested-abc123
        prompt: "Find all critical alerts from last hour"
        expected:
          tools: [search_alerts, filter_alerts]
          toolSequence: [search_alerts, filter_alerts]
        evaluators: [tool-selection, agent-efficiency, correctness]
```

## Failure Clustering

The harvest command uses ES aggregations to group failures by pattern:

| Severity | Threshold | Description |
|----------|-----------|-------------|
| Critical | > 50 traces | Widespread systematic failure |
| High | > 20 traces | Frequent failure pattern |
| Medium | > 5 traces | Occasional failure |
| Low | ≤ 5 traces | Isolated incidents |

## MCP Tool

```
harvest_traces({
  endpoint: "https://my-cluster.es.io",
  api_key: "...",
  time_from: "now-7d",
  score_threshold: 0.3,
  max_tests: 10
})
```
