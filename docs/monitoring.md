# Production Monitoring

Continuously score OTel traces in real-time with live evaluator scoring, an ANSI terminal UI, and statistical anomaly detection.

## Architecture

The monitor ingests OpenTelemetry traces through two channels:

| Mode | Description |
|------|-------------|
| **stdin** | Reads newline-delimited JSON from standard input (pipe from OTel collector) |
| **HTTP** | Starts an HTTP server that accepts `POST /v1/traces` with OTel JSON lines (OTLP-compatible) |

Both modes feed traces into the scoring engine and anomaly detector with a sliding window.

## Live Evaluator Scoring

Unlike the previous release (latency anomaly detection only), the monitor now runs evaluators against every incoming trace in real time:

- **Per-evaluator breakdown** — each configured evaluator scores independently; pass/fail shown per trace
- **Real-time terminal UI** — ANSI-colored bar charts update in place; compact mode available
- **Session management** — sessions are tracked with configurable idle timeout; stale sessions are auto-closed
- **HTTP OTLP receiver** — the built-in HTTP server now accepts standard OTLP JSON (`application/json`) in addition to the existing newline-delimited format

### Terminal UI

The default view shows a live-updating table with per-evaluator scores and a bar chart of the rolling pass rate:

```
[monitor] session: s-abc123  traces: 42  window: 100
┌─────────────────────────┬───────┬──────┐
│ Evaluator               │ Score │ Pass │
├─────────────────────────┼───────┼──────┤
│ tool-selection          │ 0.91  │  ✓   │
│ agent-efficiency        │ 0.74  │  ✓   │
│ security                │ 1.00  │  ✓   │
└─────────────────────────┴───────┴──────┘
Pass rate [████████░░] 82%  anomalies: 3
```

Use `--compact` for a single-line summary per trace, or `--json` to emit machine-readable output.

## OTel JSON Format

Each line is a JSON object representing a span:

```json
{
  "traceId": "abc123",
  "spanId": "span1",
  "name": "tool-call",
  "startTimeUnixNano": 1710000000000000000,
  "endTimeUnixNano": 1710000000500000000,
  "attributes": [
    { "key": "tool.name", "value": { "stringValue": "search_tool" } }
  ]
}
```

The parser extracts `traceId`, `name`, and computes latency from start/end times.

## Anomaly Detection

The monitor uses a **z-score** algorithm with a configurable sliding window:

1. Maintains a rolling window of the last N latency values.
2. Computes mean and standard deviation over the window.
3. For each new trace, calculates `z = |value - mean| / stddev`.
4. If `z > threshold`, the trace is flagged as an anomaly.

This catches sudden latency spikes, gradual degradation (as the window shifts), and intermittent failures.

## CLI Usage

### stdin Mode

Pipe traces from an OTel collector or log file:

```bash
# From a running collector
otel-collector export --format json | cursor-plugin-evals monitor --stdin

# From a file
cat traces.jsonl | cursor-plugin-evals monitor --stdin

# Custom window and threshold
cursor-plugin-evals monitor --stdin --window 200 --z-threshold 3.0
```

### HTTP Mode

Start an HTTP server for trace ingestion:

```bash
# Start on port 4318 (standard OTel HTTP port)
cursor-plugin-evals monitor --port 4318

# Check stats
curl http://localhost:4318/stats
```

The server exposes two endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/traces` | POST | Ingest OTel JSON lines |
| `/stats` | GET | Return current trace count and latency statistics |

### Updated CLI Examples

```bash
# Live scoring with evaluators and terminal UI
cursor-plugin-evals monitor --stdin -e tool-selection agent-efficiency security

# Per-evaluator breakdown
cursor-plugin-evals monitor --stdin -e tool-selection agent-efficiency --details

# Compact mode (one line per trace)
cursor-plugin-evals monitor --port 4318 --compact

# Machine-readable JSON output
cursor-plugin-evals monitor --stdin --json | jq '.score'

# Custom session timeout (close idle sessions after 5 minutes)
cursor-plugin-evals monitor --stdin --session-timeout 300
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--stdin` | — | Read from standard input |
| `--port <n>` | — | Start HTTP server on this port (OTLP-compatible) |
| `-e, --evaluators <names...>` | — | Evaluators to run on each trace |
| `--details` | — | Show per-evaluator score breakdown per trace |
| `--compact` | — | One-line summary per trace instead of full UI |
| `--json` | — | Emit machine-readable JSON output |
| `--session-timeout <s>` | `600` | Idle session timeout in seconds |
| `--window <n>` | `100` | Sliding window size for anomaly detection |
| `--z-threshold <n>` | `2.0` | Z-score threshold for anomaly alerts |

## Integration with Notifications

Combine monitoring with the notification system to alert on anomalies:

```yaml
notifications:
  slack:
    webhook_url: ${SLACK_WEBHOOK_URL}
  triggers:
    - on: anomaly
```

## Programmatic API

```typescript
import {
  parseOtelJsonLine, consumeStdin,
  createAnomalyDetector,
} from 'cursor-plugin-evals';
import type { TraceEvent, AnomalyDetector } from 'cursor-plugin-evals';

// Parse a single JSON line
const event: TraceEvent | null = parseOtelJsonLine('{"traceId":"abc",...}');
if (event) {
  console.log(`Trace: ${event.traceId}, latency: ${event.endTime - event.startTime}ms`);
}

// Create an anomaly detector
const detector: AnomalyDetector = createAnomalyDetector(100, 2.0);

// Feed values and check for anomalies
detector.addScore('latency', 50);
detector.addScore('latency', 55);
detector.addScore('latency', 500); // spike

if (detector.isAnomaly('latency', 500)) {
  console.log('Anomaly detected!');
}

// Get current statistics
const stats = detector.getStats('latency');
console.log(`Mean: ${stats?.mean.toFixed(1)}ms, StdDev: ${stats?.stddev.toFixed(1)}ms`);

// Stream from stdin
for await (const event of consumeStdin()) {
  const latency = event.endTime - event.startTime;
  detector.addScore('latency', latency);
  if (detector.isAnomaly('latency', latency)) {
    console.warn(`ANOMALY: ${event.traceId} — ${latency}ms`);
  }
}
```

## See Also

- [Visual Trace Viewer](./visual-trace-viewer.md)
- [Trace Ingestion](./trace-import.md)
- [Notifications](./notifications.md)
