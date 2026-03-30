# Live Scoring

Score OTel traces in real-time as they arrive. Get instant quality feedback during development.

## Usage

### Stdin mode (pipe from OTel collector)

```bash
# Score traces from EDOT collector
otel-collector --output json | cursor-plugin-evals monitor \
  --evaluators tool-selection,security,agent-efficiency \
  --details
```

### HTTP OTLP receiver

```bash
# Start OTLP receiver on port 4318
cursor-plugin-evals monitor --port 4318 --evaluators tool-selection,response-quality

# Configure your agent's OTel exporter:
# OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--evaluators <names>` | `tool-selection,response-quality,security` | Comma-separated evaluator names |
| `--port <n>` | _(stdin mode)_ | Start HTTP OTLP receiver |
| `--details` | `false` | Show per-evaluator score breakdown |
| `--compact` | `false` | Single-line output per trace |
| `--json` | `false` | Output JSON lines |
| `--anomaly-threshold <n>` | `2.0` | Z-score threshold for anomaly detection |
| `--session-timeout <ms>` | `120000` | Session inactivity timeout |

## Output Modes

**Default** — color-coded scores with pass/fail indicators

**`--details`** — per-evaluator breakdown with bar charts

**`--compact`** — single line per trace for high-throughput

**`--json`** — machine-readable JSON lines for piping to other tools

## How It Works

1. Traces arrive via stdin or HTTP POST to `/v1/traces`
2. Events are grouped into sessions by `traceId`
3. Scoring is debounced (2s default) to wait for complete traces
4. Each trace is scored by all configured evaluators
5. Z-score anomaly detection flags statistical outliers
6. Results are rendered in real-time via the terminal UI
