# Visual Trace Viewer

Browse evaluation traces with an interactive timeline, tool call details, and evaluator score breakdowns.

## Dashboard

Start the web dashboard:

```bash
cursor-plugin-evals dashboard

# Custom port
cursor-plugin-evals dashboard -p 8080

# Skip auto-opening browser
cursor-plugin-evals dashboard --no-open
```

The dashboard runs at `http://localhost:6280` by default.

## What It Shows

### Run Overview

The main page lists all evaluation runs with:
- Run ID and timestamp
- Overall score and grade
- Pass/fail counts
- Duration

### Suite Drill-Down

Click a run to see suite-level results:
- Per-suite pass rate
- Evaluator score heatmap
- Duration per suite

### Test Timeline

Each test shows a timeline of:
- **LLM calls** — prompt sent, tokens used, latency
- **Tool calls** — tool name, arguments, result, latency
- **Evaluator scores** — per-evaluator score with pass/fail

### Trace View

For LLM tests, the trace view shows the full agent loop:

```
[0ms]   User → "Search for error logs"
[50ms]  LLM → tool_call: search_tool({query: "error logs", ...})
[200ms] Tool → {content: [{text: "..."}]}
[250ms] LLM → tool_call: search_tool({query: "error logs last hour", ...})
[400ms] Tool → {content: [{text: "..."}]}
[450ms] LLM → "I found 42 error logs in the last hour..."
[500ms] Evaluators: tool-selection: 0.95 ✅, response-quality: 0.88 ✅
```

## How to Access

The dashboard reads from `.cursor-plugin-evals/dashboard.db` (SQLite), which is populated after each `run` command.

To generate the data without the dashboard:

```bash
# Run evals (populates the database)
cursor-plugin-evals run

# Then start the dashboard
cursor-plugin-evals dashboard
```

## Data Extraction API

Extract trace view data programmatically:

```typescript
import { extractTraceViewData, renderTraceHtml } from 'cursor-plugin-evals';
import type { TraceViewData } from 'cursor-plugin-evals';

// Extract structured data from test results
const data: TraceViewData = extractTraceViewData(testResult);

console.log(`Test: ${data.testName}`);
console.log(`Timeline entries: ${data.timeline.length}`);

for (const entry of data.timeline) {
  console.log(`  [${entry.timestampMs}ms] ${entry.type}: ${entry.summary}`);
}

// Render as standalone HTML page
const html: string = renderTraceHtml(data);
writeFileSync('trace.html', html);
```

## See Also

- [Production Monitoring](./monitoring.md)
- [Trace Ingestion](./trace-import.md)
- [Getting Started](./getting-started.md)
