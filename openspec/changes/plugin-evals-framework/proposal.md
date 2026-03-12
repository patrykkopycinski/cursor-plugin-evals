## Why

The elastic-cursor-plugin exposes 34 MCP tools, 7 API reference resources, 10
skills, 9 rules, 2 agents, and 4 commands through a single Cursor plugin. There
is no automated way to verify that these components work correctly end-to-end --
from MCP protocol transport, through tool execution against a live
Elasticsearch/Kibana cluster, to whether an LLM selects the right tool for a
given user prompt. The existing elastic-evals framework in agent-skills-sandbox
is tightly coupled to security skill shell scripts and cannot test MCP-based
plugin tools without extensive re-architecture.

A standalone testing framework purpose-built for Cursor plugins solves this by
providing MCP-native tool execution, three distinct testing layers (unit,
integration, LLM eval), and reusable infrastructure that any Cursor plugin can
adopt.

## What Changes

- New standalone npm package `cursor-plugin-evals` with CLI, MCP client, test
  runner, evaluators, fixture system, tracing, and Docker infrastructure
- MCP stdio client that spawns any plugin server as a child process and
  communicates via `@modelcontextprotocol/sdk`
- Three testing layers: unit (schema/registration validation), integration (MCP
  tool execution against live/mock cluster), LLM eval (agent loop with tool
  selection scoring)
- Fixture recorder/responder for MCP tool call/response pairs enabling mock-mode
  testing without a live cluster
- OpenTelemetry tracing with dual export to EDOT Collector (Elasticsearch) and
  LangSmith
- Docker Compose stack with ephemeral test cluster and persistent observability
  cluster
- YAML-based test suite configuration (`plugin-eval.yaml`)
- Seven evaluators: tool-selection, tool-args, tool-sequence, response-quality,
  cluster-state, mcp-protocol, security
- Commander CLI with run, record, replay, doctor, and generate subcommands
- Initial test suites for the elastic-cursor-plugin (gateway tools, security
  operations, discovery workflows, error handling)

## Capabilities

### New Capabilities

- `mcp-client`: MCP stdio client that spawns plugin servers, discovers tools,
  executes tool calls, reads resources, and manages process lifecycle
- `schema-converter`: Converts MCP JSON Schema tool definitions to OpenAI
  function-calling format for LLM agent loops
- `config-loader`: YAML-based plugin eval configuration with suite definitions,
  infrastructure settings, tracing config, and threshold defaults
- `unit-testing-layer`: Registration validation, Zod schema verification,
  conditional registration checks, and response format assertions without any
  external dependencies
- `integration-testing-layer`: MCP tool execution against live or mock clusters
  with assertion checking, workflow chain validation, error handling tests, and
  resource provider verification
- `llm-eval-layer`: Agent loop that pairs an LLM with MCP tool execution,
  supporting multi-turn conversations, tool selection evaluation, and mock mode
- `evaluators`: Seven scoring modules -- tool-selection, tool-args,
  tool-sequence, response-quality, cluster-state, mcp-protocol, security
- `fixture-system`: Record and replay MCP tool call/response pairs with
  compressed JSONL storage, argument hashing, exact/fuzzy matching, and freshness
  tracking
- `tracing`: OpenTelemetry instrumentation with dual export to EDOT Collector
  and LangSmith, semantic span hierarchy matching elastic-evals convention
- `reporting`: Terminal and markdown report generation plus Elasticsearch export
  to the kibana-evaluations datastream for dashboard compatibility
- `docker-infrastructure`: Docker Compose stack with ephemeral test
  ES/Kibana cluster, persistent observability cluster, and EDOT collector
- `cli`: Commander-based CLI with run, record, replay, doctor, and generate
  subcommands with layer/suite/mock/model filtering
- `test-runner`: Orchestrator that routes suites to the correct layer, manages
  concurrency, collects results, and drives evaluators

### Modified Capabilities

(None -- this is a greenfield project.)

## Impact

- New GitHub repository `patrykkopycinski/cursor-plugin-evals`
- Dependencies: `@modelcontextprotocol/sdk`, `@opentelemetry/*`, `commander`,
  `yaml`, `p-limit`, `zod`, `object-hash`
- Docker resources: 5 containers (2x ES, 2x Kibana, 1x EDOT collector) using
  approximately 4 GB RAM
- LLM API costs: LLM eval layer calls OpenAI/Anthropic/Bedrock APIs; mock mode
  avoids cluster costs but still requires LLM calls for agent loop tests
- Integration with elastic-cursor-plugin: referenced by path via `PLUGIN_DIR`
  environment variable; no code coupling
- Observability: traces and eval scores flow to the same ES observability
  cluster and LangSmith project as elastic-evals, enabling unified dashboards
