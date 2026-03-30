# OTel Evaluation Events

Emit evaluator results as standard OpenTelemetry `gen_ai.evaluation.result` events. Scores appear inline on trace spans in Kibana APM.

## How It Works

After an eval run, evaluation results are exported as OTel events attached to spans:

```
Agent Trace (original)
└─ span: tool:search
   └─ event: gen_ai.evaluation.result  ← eval score appears here
       ├─ gen_ai.evaluation.name: "tool-selection"
       ├─ gen_ai.evaluation.score.value: 0.95
       ├─ gen_ai.evaluation.score.label: "pass"
       └─ gen_ai.evaluation.explanation: "Correct tool selected"
```

## Configuration

```yaml
tracing:
  otel_endpoint: http://localhost:4318
  emit_eval_events: true  # export eval results as OTel events
```

## Event Attributes

Following the [OTel GenAI SIG](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/) standard:

| Attribute | Type | Description |
|-----------|------|-------------|
| `gen_ai.evaluation.name` | string | Evaluator name |
| `gen_ai.evaluation.score.value` | double | Score (0.0-1.0) |
| `gen_ai.evaluation.score.label` | string | "pass", "fail", or "skipped" |
| `gen_ai.evaluation.explanation` | string | Explanation text |
| `eval.run_id` | string | Eval run identifier |
| `eval.test_name` | string | Test name |
| `eval.evaluator.kind` | string | "CODE" or "LLM" |

## Programmatic API

```typescript
import { exportEvalEventsToElastic } from 'cursor-plugin-evals/otel/eval-events';

await exportEvalEventsToElastic(runResult, 'http://localhost:4318', {
  apiKey: process.env.ES_API_KEY,
  originalTraceId: 'abc123',  // correlate with agent trace
});
```
