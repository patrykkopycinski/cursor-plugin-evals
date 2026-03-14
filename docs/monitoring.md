# Production Monitoring

Continuously score OTel traces in real-time and detect quality anomalies using z-score analysis.

## Architecture

The monitor ingests OpenTelemetry traces through two channels:

| Mode | Description |
|------|-------------|
| **stdin** | Reads newline-delimited JSON from standard input (pipe from OTel collector) |
| **HTTP** | Starts an HTTP server that accepts `POST /v1/traces` with OTel JSON lines |

Both modes feed traces into an anomaly detector with a sliding window.

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

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--stdin` | — | Read from standard input |
| `--port <n>` | — | Start HTTP server on this port |
| `-e, --evaluators <names...>` | — | Evaluators to run on each trace |
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
