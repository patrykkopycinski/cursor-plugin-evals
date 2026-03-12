## Context

The elastic-cursor-plugin is a monorepo with 8 packages exposing 34 MCP tools,
7 API reference resources, 10 skills, 9 rules, 2 agents, and 4 commands through
a single Cursor plugin. It uses `@modelcontextprotocol/sdk` with
`StdioServerTransport` for tool communication.

The existing elastic-evals framework in agent-skills-sandbox tests security
skills that execute via shell scripts (`execSync` to Node.js scripts). Its
architecture is fundamentally incompatible with MCP-based plugin testing: tools
are hardcoded in `TOOL_CATALOG`/`TOOL_SCHEMAS`, fixtures record shell I/O, and
directory conventions assume `skills/<group>/<skill>/` layout.

This framework is a standalone package that provides full-stack testing for any
Cursor plugin that exposes an MCP server.

### Stakeholders

- Plugin authors (elastic-cursor-plugin maintainers)
- Skill authors who need to verify skill+tool interaction quality
- CI systems that gate plugin releases on quality thresholds

### Constraints

- The plugin MCP server uses stdio transport (not HTTP), so the framework must
  spawn it as a child process
- Plugin tools depend on external services (Elasticsearch, Kibana, Cloud) that
  must be available or mocked
- LLM API calls have cost and latency implications
- Docker is required for the test cluster infrastructure

## Goals / Non-Goals

**Goals:**

- Test any Cursor plugin that exposes an MCP server via stdio transport
- Support three testing layers (unit, integration, LLM eval) independently
- Enable mock-mode testing without a live cluster via fixture recording/replay
- Produce traces in both Elasticsearch and LangSmith for observability
- Export evaluation scores to the `kibana-evaluations` datastream for dashboard
  compatibility with existing elastic-evals dashboards
- Provide a CLI that is simple enough to run in CI with a single command

**Non-Goals:**

- Testing Cursor IDE behavior (UI interactions, editor state, file system ops)
- Testing non-MCP plugin components (skills, rules, agents, commands are
  evaluated through the tools they invoke, not directly)
- Replacing the elastic-evals framework for security skill testing
- Supporting HTTP-transport MCP servers (stdio only, matching Cursor's model)
- Providing a plugin authoring or scaffolding tool

## Decisions

### D1: MCP stdio child process over HTTP client

**Decision:** Spawn the plugin's MCP server as a child process and communicate
via `StdioClientTransport` from `@modelcontextprotocol/sdk`.

**Rationale:** This matches exactly how Cursor uses plugins in production. HTTP
transport would require the plugin to support a different protocol and introduce
network complexity. The child process approach also simplifies lifecycle
management (kill process = clean shutdown).

**Alternative considered:** HTTP/SSE transport with a wrapper. Rejected because
it adds a protocol layer the plugin does not natively support, and test fidelity
decreases when the transport differs from production.

### D2: Dynamic tool discovery over static catalog

**Decision:** The framework discovers available tools at runtime by calling
`tools/list` on the MCP server, rather than maintaining a static tool catalog.

**Rationale:** Static catalogs (like elastic-evals' `TOOL_CATALOG`) drift from
reality. Dynamic discovery means tests always reflect the plugin's actual tool
surface. It also makes the framework plugin-agnostic.

**Alternative considered:** Import plugin packages and extract Zod schemas
directly. Rejected for the integration and LLM layers because it bypasses the
MCP protocol (the unit layer does use direct imports for schema validation).

### D3: Three independent layers with shared McpPluginClient

**Decision:** Unit, integration, and LLM eval layers are independent but share
the `McpPluginClient` for MCP communication.

**Rationale:** Each layer has different infrastructure requirements (unit: none,
integration: cluster, LLM: cluster + LLM API). Independence means you can run
unit tests in CI without Docker, integration tests without LLM costs, and full
LLM evals when quality gating a release.

**Architecture:**

```
TestRunner
  ├── UnitLayer       (imports plugin packages directly, no McpPluginClient)
  ├── IntegrationLayer (uses McpPluginClient → live/mock cluster)
  └── LlmEvalLayer    (uses McpPluginClient + LlmClient → agent loop)
```

### D4: Direct LLM API calls with optional LiteLLM proxy

**Decision:** Use direct API calls to OpenAI/Anthropic/Bedrock by default. If
`LITELLM_PROXY_URL` is set, route through the proxy for model routing and cost
tracking.

**Rationale:** Minimizes infrastructure dependencies for getting started. The
elastic-evals codebase proves this pattern works (see `resolveTaskClient` in
`packages/elastic-evals/src/tasks/plain-llm.ts`).

**Alternative considered:** Require LiteLLM. Rejected because it couples the
standalone framework to Docker infrastructure and adds setup friction.

### D5: Fixture system with MCP envelope recording

**Decision:** Record full MCP tool call/response envelopes (tool name,
arguments, argument hash, response content array, latency) rather than just
tool results.

**Rationale:** MCP responses include metadata (content type, isError flag)
beyond the raw result. Recording the full envelope enables the `mcp-protocol`
evaluator to verify protocol-level correctness during replay.

**Storage format:** Compressed JSONL (`.jsonl.gz`) matching the elastic-evals
convention for consistency.

### D6: OpenTelemetry for all tracing

**Decision:** Use the OpenTelemetry SDK for tracing with OTLP/HTTP export to
EDOT Collector. LangSmith integration via callback or OTLP bridge.

**Rationale:** OTel is the standard the elastic-evals framework already uses.
Using the same span naming conventions (`eval.*` attribute namespace) means
existing Kibana APM dashboards work without modification.

**Span hierarchy:**
```
run (run_id, model, config)
  └── suite (suite_name, layer)
       └── test (test_name, prompt)
            ├── mcp_tool_call (tool_name, args_hash, latency)
            ├── llm_call (model, input_tokens, output_tokens)
            └── evaluator (evaluator_name, score, label)
```

### D7: Evaluation score export to kibana-evaluations

**Decision:** Export scores to the same `kibana-evaluations` datastream used by
elastic-evals, with the same document schema.

**Rationale:** Unified dashboards across skill evals and plugin evals. No need
to build new Kibana dashboards.

**Key document fields:** `@timestamp`, `run_id`, `experiment_id`, `test_name`,
`tool_calls`, `evaluator_results[]`, `model`, `latency_ms`, `token_usage`,
`adapter: "mcp-plugin"`.

### D8: One McpPluginClient per suite

**Decision:** Create one MCP server connection per suite, not per test. Tests
within a suite reuse the connection.

**Rationale:** Spawning a new child process per test adds 1-3 seconds of startup
overhead. For a suite with 20 tests, that is 20-60 seconds of waste. One
connection per suite keeps the server warm while maintaining isolation between
suites (fresh process per suite).

## Risks / Trade-offs

**[MCP SDK stability]** The `@modelcontextprotocol/sdk` is relatively new and
its client-side stdio API may change. Mitigation: pin the SDK version, wrap
SDK calls in an abstraction layer (`McpPluginClient`).

**[Child process reliability]** The plugin server may crash, hang, or leak
memory during long test runs. Mitigation: per-test timeout with process kill,
per-suite fresh process, health check after connection.

**[LLM cost for eval layer]** Running LLM evals with 3 repetitions across
multiple models is expensive. Mitigation: mock mode for development iteration,
reserve full LLM evals for CI/release gating, support `--repeat 1` for quick
checks.

**[Docker resource usage]** The full stack uses ~4 GB RAM (2x ES + 2x Kibana +
EDOT). Mitigation: lite mode with only obs cluster for mock evals, document
minimum system requirements.

**[Fixture staleness]** Recorded fixtures may not reflect current plugin
behavior after code changes. Mitigation: freshness checks (14/30-day
thresholds), CI job that re-records fixtures weekly.

**[OpenAI function-calling format drift]** The schema converter assumes current
OpenAI function-calling format. Mitigation: version the converter, test against
multiple LLM providers.

## Open Questions

1. Should the framework support testing multiple plugins in a single run (e.g.,
   testing plugin A's tools alongside plugin B's tools)?
2. Should the unit layer validate skill/rule/agent markdown files in addition to
   MCP tools, or stay focused on tools only?
3. What is the right default concurrency for integration tests? Serial (1) is
   safest but slow; parallel risks cluster state conflicts between tests.
