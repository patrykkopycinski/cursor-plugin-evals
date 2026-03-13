## 1. Project Scaffold

- [x] 1.1 Initialize package.json with name, version, ESM type, bin entry, scripts (build, test, lint, typecheck)
- [x] 1.2 Create tsconfig.json with strict mode, ESM module resolution, path aliases
- [x] 1.3 Create vitest.config.ts for framework's own tests
- [x] 1.4 Create tsup.config.ts for building the CLI binary
- [x] 1.5 Add .gitignore, .prettierrc, eslint.config.js
- [x] 1.6 Install runtime dependencies: @modelcontextprotocol/sdk, commander, yaml, p-limit, zod, object-hash
- [x] 1.7 Install dev dependencies: typescript, vitest, tsup, eslint, prettier
- [x] 1.8 Create src/ directory structure matching the repo layout from the design

## 2. Core Types and Config

- [x] 2.1 Create src/core/types.ts with EvaluationResult, Evaluator, Example, TaskOutput, TestResult, SuiteResult interfaces
- [x] 2.2 Create src/core/config.ts with Zod schema for plugin-eval.yaml, load function, env var interpolation
- [x] 2.3 Write tests for config loader: valid config, missing fields, env var substitution, suite-level overrides
- [x] 2.4 Create src/cli/logger.ts with colored terminal output, verbosity levels

## 3. MCP Client

- [x] 3.1 Create src/mcp/client.ts with McpPluginClient class: connect (spawn + StdioClientTransport), disconnect (kill process)
- [x] 3.2 Implement listTools() calling tools/list on the MCP connection
- [x] 3.3 Implement callTool(name, args) calling tools/call and returning structured result
- [x] 3.4 Implement listResources() and readResource(uri) for MCP resource access
- [x] 3.5 Add pre-build support: optionally run build_command before spawning server
- [x] 3.6 Add timeout handling: kill child process after configurable timeout
- [x] 3.7 Add error handling: detect process crash, connection failure, invalid tool name
- [x] 3.8 Write tests for McpPluginClient using a minimal mock MCP server
- [x] 3.9 Create src/mcp/tool-discovery.ts: call listTools(), return typed catalog with names, descriptions, schemas
- [x] 3.10 Create src/mcp/schema-converter.ts: convert MCP JSON Schema to OpenAI function-calling format
- [x] 3.11 Write tests for schema converter: primitives, nested objects, arrays, enums, discriminated unions, required fields

## 4. Unit Testing Layer

- [x] 4.1 Create src/layers/unit/registration.ts: spawn MCP server, call listTools, compare against expected tool names
- [x] 4.2 Create src/layers/unit/schema-validation.ts: for each tool, validate inputSchema is valid JSON Schema with correct required fields
- [x] 4.3 Create src/layers/unit/conditional-registration.ts: spawn with minimal env, verify gateway tools absent; spawn with full env, verify present
- [x] 4.4 Create src/layers/unit/response-format.ts: call tools with known args, verify response shape (content array, isError field)
- [x] 4.5 Write tests for unit layer functions

## 5. CLI Skeleton

- [x] 5.1 Create src/cli/main.ts with commander: run, record, replay, doctor, generate subcommands
- [x] 5.2 Implement `run` subcommand: --layer, --suite, --mock, --model, --repeat, --report, --output, --ci flags
- [x] 5.3 Implement `doctor` subcommand: check Docker services, plugin build, env vars, LLM API keys
- [x] 5.4 Implement `generate` subcommand: connect to plugin, discover tools, scaffold plugin-eval.yaml template
- [x] 5.5 Add global options: --config, --verbose, --no-color
- [x] 5.6 Add bin entry to package.json, verify CLI runs via npx

## 6. Docker Infrastructure

- [x] 6.1 Create docker/docker-compose.yml with test-es (9220), test-kibana (5620), obs-es (9210), obs-kibana (5601), edot-collector (4318), test-setup
- [x] 6.2 Create docker/docker-compose.lite.yml with obs-es, obs-kibana, edot-collector only
- [x] 6.3 Create docker/edot-collector.yml OTEL config for dual export (ES + LangSmith)
- [x] 6.4 Create docker/test-kibana.yml and docker/obs-kibana.yml Kibana configs
- [x] 6.5 Create src/docker/health.ts: check each service is healthy via HTTP
- [x] 6.6 Create src/docker/setup.ts: create API keys, seed test data

## 7. Integration Testing Layer

- [x] 7.1 Create src/layers/integration/tool-executor.ts: execute single MCP tool call, evaluate assertions against response
- [x] 7.2 Implement assertion engine: eq, neq, gt, gte, lt, lte, contains, exists, length_gte, type operators with dot-path field access
- [x] 7.3 Create src/layers/integration/workflow-chains.ts: execute sequence of tool calls with output variable binding
- [x] 7.4 Create src/layers/integration/error-handling.ts: test invalid args, missing auth, nonexistent tool
- [x] 7.5 Create src/layers/integration/resource-provider.ts: list and read all MCP resources, verify content
- [x] 7.6 Implement setup/teardown script execution (suite-level and test-level)
- [x] 7.7 Implement cluster-state verification via direct HTTP calls after tool execution
- [x] 7.8 Write tests for assertion engine and workflow chains

## 8. Fixture System

- [x] 8.1 Create src/fixtures/storage.ts: readMaybeGz, writeGz, appendGz compression helpers
- [x] 8.2 Create src/fixtures/recorder.ts: McpFixtureRecorder class that captures tool call/response pairs during live runs
- [x] 8.3 Create src/fixtures/responder.ts: McpFixtureResponder class with exact/fuzzy/miss matching
- [x] 8.4 Implement argument hashing (SHA-256 of sorted, normalized args)
- [x] 8.5 Implement freshness checking (metadata.json with timestamp, git SHA, cluster version)
- [x] 8.6 Implement CLI `record` subcommand wiring: pass recorder to integration/llm layers
- [x] 8.7 Write tests for recorder, responder, and freshness logic

## 9. LLM Client

- [x] 9.1 Create src/layers/llm/llm-client.ts: OpenAI-compatible client with converse() method supporting tool definitions and tool_choice
- [x] 9.2 Add Anthropic direct client support (Messages API with tool_use)
- [x] 9.3 Add Bedrock direct client support (Converse API)
- [x] 9.4 Add LiteLLM proxy detection: try proxy URL, fall back to direct client
- [x] 9.5 Write tests for LLM client with mocked HTTP responses

## 10. LLM Eval Layer (Agent Loop)

- [x] 10.1 Create src/layers/llm/agent-loop.ts: LLM receives system prompt + tool catalog + user prompt, generates tool calls, adapter executes via MCP, results fed back, iterate until done or max_turns
- [x] 10.2 Create src/layers/llm/system-prompt.ts: build system prompt with plugin context, tool descriptions from MCP discovery
- [x] 10.3 Implement mock mode: substitute McpFixtureResponder for McpPluginClient tool calls
- [x] 10.4 Implement multi-model support: run same test against each model in config
- [x] 10.5 Implement token tracking: accumulate input/output/cached tokens per turn
- [x] 10.6 Implement timeout with graceful abort and partial result return
- [x] 10.7 Write tests for agent loop with mocked LLM and MCP responses

## 11. Evaluators

- [x] 11.1 Create src/evaluators/tool-selection.ts: fuzzy match expected vs actual tool names, compute recall and F1, configurable threshold
- [x] 11.2 Create src/evaluators/tool-args.ts: validate key arguments match expected values (deep equality, contains for strings)
- [x] 11.3 Create src/evaluators/tool-sequence.ts: verify tools called in expected order via subsequence matching
- [x] 11.4 Create src/evaluators/response-quality.ts: LLM-as-judge scoring of final output (0-1 score with explanation)
- [x] 11.5 Create src/evaluators/cluster-state.ts: execute HTTP assertions against ES/Kibana after tool execution
- [x] 11.6 Create src/evaluators/mcp-protocol.ts: validate MCP calls are well-formed (valid tool names, parseable args, non-error responses)
- [x] 11.7 Create src/evaluators/security.ts: detect leaked credentials, API keys, passwords in outputs
- [x] 11.8 Write tests for each evaluator with known inputs/outputs

## 12. Tracing

- [x] 12.1 Create src/tracing/otel.ts: OpenTelemetry SDK setup, TracerProvider, configurable OTLP endpoint
- [x] 12.2 Create src/tracing/exporters.ts: EDOT Collector OTLP/HTTP exporter, LangSmith exporter
- [x] 12.3 Create src/tracing/spans.ts: withRunSpan, withSuiteSpan, withTestSpan, withToolCallSpan, withLlmCallSpan, withEvaluatorSpan helpers
- [x] 12.4 Add eval.* attribute namespace to all spans for dashboard compatibility
- [x] 12.5 Wire tracing into test runner, agent loop, and evaluators
- [x] 12.6 Write tests for span creation and attribute setting

## 13. Reporting

- [x] 13.1 Create src/reporting/terminal.ts: formatted tables with pass/fail per test and evaluator, color-coded, summary line
- [x] 13.2 Create src/reporting/markdown.ts: generate markdown report with suite results, evaluator scores, failure details
- [x] 13.3 Create src/reporting/es-export.ts: bulk-index evaluation score documents to kibana-evaluations datastream
- [x] 13.4 Implement failure clustering: classify failures into categories (wrong tool, wrong args, timeout, error, hallucination)
- [x] 13.5 Implement JSON output via --output flag

## 14. Test Runner (Orchestrator)

- [x] 14.1 Create src/core/runner.ts: route suites to correct layer handler based on suite.layer
- [x] 14.2 Implement McpPluginClient lifecycle: one connection per suite, disconnect after suite
- [x] 14.3 Implement concurrency control: p-limit with configurable parallelism per layer
- [x] 14.4 Implement repetitions: repeat LLM eval tests, aggregate scores
- [x] 14.5 Implement setup/teardown orchestration at suite and test level
- [x] 14.6 Implement result aggregation: compute pass rates per suite, per evaluator, overall
- [x] 14.7 Implement --ci mode: enforce thresholds, exit non-zero on failure
- [x] 14.8 Wire runner into CLI run subcommand

## 15. Initial Test Suites for elastic-cursor-plugin

- [x] 15.1 Create plugin-eval.yaml with plugin config pointing to elastic-cursor-plugin
- [x] 15.2 Write gateway-tools suite: elasticsearch_api GET, esql_query, kibana_api, cloud_api error
- [x] 15.3 Write security-operations suite: manage_detection_rules CRUD, triage_alerts list+update, manage_cases create+attach
- [x] 15.4 Write discovery-workflows suite: discover_data -> get_cluster_context round-trip, discover_security_data
- [x] 15.5 Write agent-tool-selection suite (LLM layer): prompts for common user requests, expected tool selections
- [x] 15.6 Write error-handling suite: missing auth, invalid args, connection refused
- [x] 15.7 Create scripts/seed-security-data.js for populating test cluster with sample data

## 16. Documentation

- [x] 16.1 Write README.md with quick start, architecture overview, CLI reference
- [x] 16.2 Write CONTRIBUTING.md with development setup, testing guide, architecture notes
- [x] 16.3 Add inline JSDoc comments to public API surfaces
