# Kibana Dashboard

Deploy an eval results dashboard to Kibana — dashboard-as-code that visualizes pass rates, evaluator scores, tool analysis, and failure patterns.

## Deploy

```bash
# Deploy directly to Kibana
cursor-plugin-evals dashboard-deploy \
  --kibana-url http://localhost:5601 \
  --api-key $KIBANA_API_KEY

# Export NDJSON for version control
cursor-plugin-evals dashboard-deploy --export-only > dashboard.ndjson

# Import via Kibana UI: Management → Saved Objects → Import
```

## Dashboard Panels

| Row | Panel | Type | Shows |
|-----|-------|------|-------|
| 1 | Pass Rate Trend | Line chart | Pass rate over time, by config |
| 1 | Total Runs | Metric | Count of eval runs |
| 1 | Avg Score | Metric | Mean evaluator score |
| 1 | Failure Rate | Metric | % of failed tests |
| 2 | Score by Evaluator | Bar chart | Average score per evaluator |
| 2 | Evaluator Pass/Fail | Stacked bar | Pass vs fail count per evaluator |
| 3 | Tool Call Frequency | Treemap | Tool usage distribution |
| 3 | Tool Latency | Histogram | Latency distribution per tool |
| 4 | Failed Tests | Table | Failed test details |
| 4 | Score by Model | Line chart | Score trends across models |

## Prerequisites

Eval results must be exported to Elasticsearch. Add to `plugin-eval.yaml`:

```yaml
tracing:
  otel_endpoint: http://localhost:4318  # EDOT collector or direct ES OTLP endpoint
```

## MCP Tool

```
deploy_dashboard({
  kibana_url: "http://localhost:5601",
  api_key: "...",
  title: "My Plugin Evals"
})
```

Or export only: `deploy_dashboard({ kibana_url: "...", export_only: true })`
