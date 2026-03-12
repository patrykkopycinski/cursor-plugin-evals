## ADDED Requirements

### Requirement: Always-on tracing for every test run

The tracing system MUST create OpenTelemetry spans for every test run
automatically, with no opt-in required. A tracer provider MUST be initialized at
runner startup and shut down (with flush) at runner exit. If no exporter
endpoint is configured, the tracer MUST still create spans (using a no-op or
in-memory exporter) so that span data is available for in-process evaluators and
reporting.

#### Scenario: Spans created without explicit configuration

- **WHEN** a test run starts and no `tracing` config section is present
- **THEN** the tracer provider MUST still be initialized and spans MUST be
  created for every test, suite, and run

#### Scenario: Tracer flushes on shutdown

- **WHEN** the test runner exits (normally or via error)
- **THEN** the tracer provider MUST flush all pending spans and shut down
  gracefully before the process exits

#### Scenario: Spans available for evaluators

- **WHEN** an evaluator needs latency or call-count data during scoring
- **THEN** it MUST be able to read span data from the in-process span context

---

### Requirement: Span hierarchy

The tracing system MUST produce spans in a strict hierarchy: `run` (root) →
`suite` → `test` → leaf spans. Leaf spans MUST be one of `mcp_tool_call`,
`llm_call`, or `evaluator`. Each parent span MUST contain all of its children.
The `run` span MUST encompass the entire test execution. The `suite` span MUST
encompass all tests within that suite. The `test` span MUST encompass all tool
calls, LLM calls, and evaluator runs for that test.

#### Scenario: Full hierarchy for an LLM eval test

- **WHEN** a test in suite `query-tests` calls 2 tools and 1 LLM, then runs 3
  evaluators
- **THEN** the span tree MUST be:
  `run → suite("query-tests") → test("...") → [mcp_tool_call, mcp_tool_call, llm_call, evaluator, evaluator, evaluator]`

#### Scenario: Integration test without LLM calls

- **WHEN** an integration test calls 1 tool and runs 2 evaluators
- **THEN** the span tree MUST be:
  `run → suite("...") → test("...") → [mcp_tool_call, evaluator, evaluator]`

#### Scenario: Multiple suites

- **WHEN** a run contains 2 suites with 3 tests each
- **THEN** the `run` span MUST contain 2 `suite` child spans, each containing 3
  `test` child spans

#### Scenario: Suite-level setup/teardown spans

- **WHEN** a suite has setup and teardown scripts
- **THEN** the `suite` span MUST contain `setup` and `teardown` child spans in
  addition to the `test` spans

---

### Requirement: Span attributes

Each span MUST carry the following attributes based on its type:

- **run**: `eval.run_id`, `eval.total_suites`, `eval.total_tests`
- **suite**: `eval.suite.name`, `eval.suite.layer`, `eval.suite.test_count`
- **test**: `eval.test.name`, `eval.test.status` (pass/fail/skip/timeout)
- **mcp_tool_call**: `eval.tool.name`, `eval.tool.args_hash`,
  `eval.tool.latency_ms`, `eval.tool.is_error`
- **llm_call**: `eval.llm.model`, `eval.llm.input_tokens`,
  `eval.llm.output_tokens`, `eval.llm.cached_tokens`, `eval.llm.latency_ms`
- **evaluator**: `eval.evaluator.name`, `eval.evaluator.kind`,
  `eval.evaluator.score`, `eval.evaluator.label`

All attribute keys MUST use the `eval.` namespace prefix.

#### Scenario: Tool call span attributes

- **WHEN** `elasticsearch_api` is called with args hashing to `sha256:abc` and
  responds in 120ms with `isError: false`
- **THEN** the `mcp_tool_call` span MUST have attributes
  `eval.tool.name="elasticsearch_api"`, `eval.tool.args_hash="sha256:abc"`,
  `eval.tool.latency_ms=120`, `eval.tool.is_error=false`

#### Scenario: LLM call span with token counts

- **WHEN** an LLM call to `claude-sonnet-4-20250514` uses 1500 input tokens, 300 output
  tokens, and 200 cached tokens in 2500ms
- **THEN** the `llm_call` span MUST have attributes
  `eval.llm.model="claude-sonnet-4-20250514"`, `eval.llm.input_tokens=1500`,
  `eval.llm.output_tokens=300`, `eval.llm.cached_tokens=200`,
  `eval.llm.latency_ms=2500`

#### Scenario: Evaluator span with score

- **WHEN** the `tool-selection` evaluator scores 0.85 with label `"pass"`
- **THEN** the `evaluator` span MUST have attributes
  `eval.evaluator.name="tool-selection"`, `eval.evaluator.kind="CODE"`,
  `eval.evaluator.score=0.85`, `eval.evaluator.label="pass"`

#### Scenario: Test span status reflects outcome

- **WHEN** a test fails
- **THEN** the `test` span's `eval.test.status` attribute MUST be `"fail"` and
  the span's OTel status MUST be set to `ERROR`

---

### Requirement: EDOT Collector export via OTLP/HTTP

The tracing system MUST support exporting spans to an Elastic Distribution of
OpenTelemetry (EDOT) Collector via OTLP/HTTP. The endpoint MUST be configurable
via `tracing.otel_endpoint` in the config (default `http://localhost:4318`). The
exporter MUST send traces to the `/v1/traces` path. The exporter MUST use the
`OTLPTraceExporter` from `@opentelemetry/exporter-trace-otlp-http`. If the
endpoint is unreachable, the exporter MUST log a warning but MUST NOT fail the
test run.

#### Scenario: Export to default endpoint

- **WHEN** `tracing.otel_endpoint` is not set and a collector is running on
  `localhost:4318`
- **THEN** spans MUST be sent to `http://localhost:4318/v1/traces`

#### Scenario: Export to custom endpoint

- **WHEN** `tracing.otel_endpoint` is set to `http://collector.internal:4318`
- **THEN** spans MUST be sent to `http://collector.internal:4318/v1/traces`

#### Scenario: Collector unreachable

- **WHEN** the configured OTLP endpoint is unreachable
- **THEN** a warning MUST be logged on the first export failure, and the test
  run MUST continue without failing

#### Scenario: Traces flow to observability ES cluster

- **WHEN** spans are exported to the EDOT collector and the collector is
  configured to forward to an Elasticsearch cluster
- **THEN** the spans MUST be indexable and queryable in Elasticsearch as APM
  trace data

---

### Requirement: LangSmith export

The tracing system MUST support exporting trace data to LangSmith when
`tracing.langsmith_project` is configured. The exporter MUST send runs to the
LangSmith API using the LangSmith SDK or OTLP bridge. Each test MUST be
represented as a LangSmith run with the tool calls and LLM calls as child runs.
The LangSmith project name MUST match the configured value. If the LangSmith API
key is not set in the environment (`LANGSMITH_API_KEY`), the exporter MUST log a
warning and skip LangSmith export without failing the test run.

#### Scenario: Export to LangSmith project

- **WHEN** `tracing.langsmith_project` is set to `"plugin-evals"` and
  `LANGSMITH_API_KEY` is set in the environment
- **THEN** trace data MUST be sent to LangSmith under the `plugin-evals` project

#### Scenario: LangSmith API key missing

- **WHEN** `tracing.langsmith_project` is configured but `LANGSMITH_API_KEY` is
  not set
- **THEN** a warning MUST be logged and LangSmith export MUST be skipped without
  failing the test run

#### Scenario: LangSmith run hierarchy

- **WHEN** a test makes 2 tool calls and 1 LLM call
- **THEN** the LangSmith run for that test MUST have 3 child runs corresponding
  to the 2 tool calls and 1 LLM call

#### Scenario: Dual export (OTLP and LangSmith)

- **WHEN** both `tracing.otel_endpoint` and `tracing.langsmith_project` are
  configured
- **THEN** spans MUST be exported to both destinations independently

---

### Requirement: Trace correlation

The tracing system MUST generate a unique trace ID for each test that links all
MCP tool calls, LLM calls, and evaluator runs within that test. The trace ID
MUST be a standard W3C trace ID (32 hex characters). The trace ID MUST be
included in test results so that operators can look up the full trace in the
observability cluster or LangSmith. Parent-child relationships MUST be
maintained via span IDs so that the entire call chain is reconstructable.

#### Scenario: Trace ID in test results

- **WHEN** a test completes
- **THEN** the test result object MUST include a `trace_id` field containing a
  32-character hex string

#### Scenario: All spans share the same trace ID

- **WHEN** a test generates 3 tool call spans, 1 LLM call span, and 2 evaluator
  spans
- **THEN** all 6 spans MUST share the same trace ID

#### Scenario: Parent-child span relationships

- **WHEN** a tool call span is created within a test
- **THEN** its parent span ID MUST reference the test span, and the test span's
  parent MUST reference the suite span

#### Scenario: Trace ID is queryable in Elasticsearch

- **WHEN** spans are exported to the observability cluster via EDOT
- **THEN** querying by `trace.id` in Elasticsearch MUST return all spans for
  that test

---

### Requirement: Dashboard-compatible span naming

Span names and attributes MUST follow the elastic-evals naming convention so
that existing Kibana dashboards for elastic-evals work without modification. The
run span MUST be named `eval_run`. Suite spans MUST be named `eval_suite`.
Test spans MUST be named `eval_test`. Tool call spans MUST be named
`eval_mcp_tool_call`. LLM call spans MUST be named `eval_llm_call`. Evaluator
spans MUST be named `eval_evaluator`. All span attribute keys MUST use the
`eval.` namespace prefix as defined in the span attributes requirement.

#### Scenario: Span names match elastic-evals convention

- **WHEN** spans are exported and viewed in Kibana
- **THEN** the span names MUST be `eval_run`, `eval_suite`, `eval_test`,
  `eval_mcp_tool_call`, `eval_llm_call`, and `eval_evaluator`

#### Scenario: Existing Kibana dashboard compatibility

- **WHEN** an existing Kibana dashboard filters on
  `span.name: "eval_test"` and `eval.evaluator.score`
- **THEN** the spans from cursor-plugin-evals MUST match these filters without
  dashboard modification

#### Scenario: Attribute key namespace

- **WHEN** any span attribute is set
- **THEN** the attribute key MUST start with `eval.` (e.g., `eval.tool.name`,
  `eval.llm.model`, `eval.test.status`)
