# Trace-Based Evaluation

Evaluate OTel traces without re-executing the agent. Score recorded traces from files or Elasticsearch/EDOT with all existing evaluators.

## Why

- **Iterate cheaply** — change evaluator logic and re-score without burning LLM tokens
- **Production traces** — evaluate real user interactions from EDOT collector
- **Deterministic** — same trace produces same result every time

## File Source

Score traces from JSON files (Jaeger or OTLP format):

```yaml
suites:
  - name: trace-replay
    adapter: otel-trace
    adapter_config:
      traceSource:
        type: file
        path: ./traces/*.json
        format: auto  # 'jaeger', 'otlp', or 'auto'
    evaluators: [tool-selection, response-quality, agent-efficiency, security]
    tests:
      - name: check-search-flow
        input: { traceId: "abc123def456" }
        expected:
          tools: [search_tool]
          goldenPath: [search_tool, format_results]
```

## Elasticsearch / EDOT Source

Score production traces stored in Elasticsearch via EDOT collector:

```yaml
adapter_config:
  traceSource:
    type: elasticsearch
    endpoint: https://my-cluster.es.io
    apiKey: ${ES_API_KEY}
    index: traces-apm*,traces-generic.otel-*  # searches both APM and OTLP indices
    serviceName: my-agent
    timeRange: { from: "now-1h", to: "now" }
    docFormat: auto  # 'apm', 'otlp', or 'auto' (per-document detection)
```

Supports both EDOT indexing pipelines:
- **APM intake** (`traces-apm*`) — ECS-mapped documents
- **OTLP native** (`traces-generic.otel-*`) — OTel-native documents with `span_id`, `parent_span_id`, nanosecond durations

## MCP Tool

Evaluate traces directly from Claude Code or any MCP client:

```
evaluate_trace({
  trace_file: "./traces/session.json",
  evaluators: ["tool-selection", "security", "agent-efficiency"]
})
```

Or from Elasticsearch:

```
evaluate_trace({
  es_endpoint: "https://my-cluster.es.io",
  es_api_key: "...",
  trace_id: "abc123",
  evaluators: ["tool-selection", "response-quality"]
})
```

## How It Works

The `otel-trace` adapter:
1. Reads trace data from the configured source (file or ES)
2. Parses OTel spans into a span tree
3. Extracts tool calls from `tool.name`, `mcp.tool`, `gen_ai.tool.name` attributes
4. Extracts messages from `gen_ai.prompt` / `gen_ai.completion` attributes
5. Extracts token usage from `gen_ai.usage.*` attributes
6. Converts to `TaskOutput` — the same format every other adapter produces
7. Feeds into evaluators — all 37 evaluators work without modification

## Custom Attribute Mapping

If your OTel exporter uses non-standard attribute names:

```yaml
adapter_config:
  traceMapping:
    tool.name: my_custom.tool_name
    gen_ai.prompt: custom.user_input
    gen_ai.completion: custom.agent_response
```
