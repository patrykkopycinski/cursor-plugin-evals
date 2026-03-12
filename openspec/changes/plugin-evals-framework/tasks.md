## 1. Project Scaffold

- [ ] 1.1 Initialize package.json with name, version, ESM type, bin entry, scripts (build, test, lint, typecheck)
- [ ] 1.2 Create tsconfig.json with strict mode, ESM module resolution, path aliases
- [ ] 1.3 Create vitest.config.ts for framework's own tests
- [ ] 1.4 Create tsup.config.ts for building the CLI binary
- [ ] 1.5 Add .gitignore, .prettierrc, eslint.config.js
- [ ] 1.6 Install runtime dependencies: @modelcontextprotocol/sdk, commander, yaml, p-limit, zod, object-hash
- [ ] 1.7 Install dev dependencies: typescript, vitest, tsup, eslint, prettier
- [ ] 1.8 Create src/ directory structure matching the repo layout from the design

## 2. Core Types and Config

- [ ] 2.1 Create src/core/types.ts with EvaluationResult, Evaluator, Example, TaskOutput, TestResult, SuiteResult interfaces
- [ ] 2.2 Create src/core/config.ts with Zod schema for plugin-eval.yaml, load function, env var interpolation
- [ ] 2.3 Write tests for config loader: valid config, missing fields, env var substitution, suite-level overrides
- [ ] 2.4 Create src/cli/logger.ts with colored terminal output, verbosity levels

## 3. MCP Client

- [ ] 3.1 Create src/mcp/client.ts with McpPluginClient class: connect (spawn + StdioClientTransport), disconnect (kill process)
- [ ] 3.2 Implement listTools() calling tools/list on the MCP connection
- [ ] 3.3 Implement callTool(name, args) calling tools/call and returning structured result
- [ ] 3.4 Implement listResources() and readResource(uri) for MCP resource access
- [ ] 3.5 Add pre-build support: optionally run build_command before spawning server
- [ ] 3.6 Add timeout handling: kill child process after configurable timeout
- [ ] 3.7 Add error handling: detect process crash, connection failure, invalid tool name
- [ ] 3.8 Write tests for McpPluginClient using a minimal mock MCP server
- [ ] 3.9 Create src/mcp/tool-discovery.ts: call listTools(), return typed catalog with names, descriptions, schemas
- [ ] 3.10 Create src/mcp/schema-converter.ts: convert MCP JSON Schema to OpenAI function-calling format
- [ ] 3.11 Write tests for schema converter: primitives, nested objects, arrays, enums, discriminated unions, required fields

## 4. Unit Testing Layer

- [ ] 4.1 Create src/layers/unit/registration.ts: spawn MCP server, call listTools, compare against expected tool names
- [ ] 4.2 Create src/layers/unit/schema-validation.ts: for each tool, validate inputSchema is valid JSON Schema with correct required fields
- [ ] 4.3 Create src/layers/unit/conditional-registration.ts: spawn with minimal env, verify gateway tools absent; spawn with full env, verify present
- [ ] 4.4 Create src/layers/unit/response-format.ts: call tools with known args, verify response shape (content array, isError field)
- [ ] 4.5 Write tests for unit layer functions

## 5. CLI Skeleton

- [ ] 5.1 Create src/cli/main.ts with commander: run, record, replay, doctor, generate subcommands
- [ ] 5.2 Implement `run` subcommand: --layer, --suite, --mock, --model, --repeat, --report, --output, --ci flags
- [ ] 5.3 Implement `doctor` subcommand: check Docker services, plugin build, env vars, LLM API keys
- [ ] 5.4 Implement `generate` subcommand: connect to plugin, discover tools, scaffold plugin-eval.yaml template
- [ ] 5.5 Add global options: --config, --verbose, --no-color
- [ ] 5.6 Add bin entry to package.json, verify CLI runs via npx

## 6. Docker Infrastructure

- [ ] 6.1 Create docker/docker-compose.yml with test-es (9220), test-kibana (5620), obs-es (9210), obs-kibana (5601), edot-collector (4318), test-setup
- [ ] 6.2 Create docker/docker-compose.lite.yml with obs-es, obs-kibana, edot-collector only
- [ ] 6.3 Create docker/edot-collector.yml OTEL config for dual export (ES + LangSmith)
- [ ] 6.4 Create docker/test-kibana.yml and docker/obs-kibana.yml Kibana configs
- [ ] 6.5 Create src/docker/health.ts: check each service is healthy via HTTP
- [ ] 6.6 Create src/docker/setup.ts: create API keys, seed test data

## 7. Integration Testing Layer

- [ ] 7.1 Create src/layers/integration/tool-executor.ts: execute single MCP tool call, evaluate assertions against response
- [ ] 7.2 Implement assertion engine: eq, neq, gt, gte, lt, lte, contains, exists, length_gte, type operators with dot-path field access
- [ ] 7.3 Create src/layers/integration/workflow-chains.ts: execute sequence of tool calls with output variable binding
- [ ] 7.4 Create src/layers/integration/error-handling.ts: test invalid args, missing auth, nonexistent tool
- [ ] 7.5 Create src/layers/integration/resource-provider.ts: list and read all MCP resources, verify content
- [ ] 7.6 Implement setup/teardown script execution (suite-level and test-level)
- [ ] 7.7 Implement cluster-state verification via direct HTTP calls after tool execution
- [ ] 7.8 Write tests for assertion engine and workflow chains

## 8. Fixture System

- [ ] 8.1 Create src/fixtures/storage.ts: readMaybeGz, writeGz, appendGz compression helpers
- [ ] 8.2 Create src/fixtures/recorder.ts: McpFixtureRecorder class that captures tool call/response pairs during live runs
- [ ] 8.3 Create src/fixtures/responder.ts: McpFixtureResponder class with exact/fuzzy/miss matching
- [ ] 8.4 Implement argument hashing (SHA-256 of sorted, normalized args)
- [ ] 8.5 Implement freshness checking (metadata.json with timestamp, git SHA, cluster version)
- [ ] 8.6 Implement CLI `record` subcommand wiring: pass recorder to integration/llm layers
- [ ] 8.7 Write tests for recorder, responder, and freshness logic

## 9. LLM Client

- [ ] 9.1 Create src/layers/llm/llm-client.ts: OpenAI-compatible client with converse() method supporting tool definitions and tool_choice
- [ ] 9.2 Add Anthropic direct client support (Messages API with tool_use)
- [ ] 9.3 Add Bedrock direct client support (Converse API)
- [ ] 9.4 Add LiteLLM proxy detection: try proxy URL, fall back to direct client
- [ ] 9.5 Write tests for LLM client with mocked HTTP responses

## 10. LLM Eval Layer (Agent Loop)

- [ ] 10.1 Create src/layers/llm/agent-loop.ts: LLM receives system prompt + tool catalog + user prompt, generates tool calls, adapter executes via MCP, results fed back, iterate until done or max_turns
- [ ] 10.2 Create src/layers/llm/system-prompt.ts: build system prompt with plugin context, tool descriptions from MCP discovery
- [ ] 10.3 Implement mock mode: substitute McpFixtureResponder for McpPluginClient tool calls
- [ ] 10.4 Implement multi-model support: run same test against each model in config
- [ ] 10.5 Implement token tracking: accumulate input/output/cached tokens per turn
- [ ] 10.6 Implement timeout with graceful abort and partial result return
- [ ] 10.7 Write tests for agent loop with mocked LLM and MCP responses

## 11. Evaluators

- [ ] 11.1 Create src/evaluators/tool-selection.ts: fuzzy match expected vs actual tool names, compute recall and F1, configurable threshold
- [ ] 11.2 Create src/evaluators/tool-args.ts: validate key arguments match expected values (deep equality, contains for strings)
- [ ] 11.3 Create src/evaluators/tool-sequence.ts: verify tools called in expected order via subsequence matching
- [ ] 11.4 Create src/evaluators/response-quality.ts: LLM-as-judge scoring of final output (0-1 score with explanation)
- [ ] 11.5 Create src/evaluators/cluster-state.ts: execute HTTP assertions against ES/Kibana after tool execution
- [ ] 11.6 Create src/evaluators/mcp-protocol.ts: validate MCP calls are well-formed (valid tool names, parseable args, non-error responses)
- [ ] 11.7 Create src/evaluators/security.ts: detect leaked credentials, API keys, passwords in outputs
- [ ] 11.8 Write tests for each evaluator with known inputs/outputs

## 12. Tracing

- [ ] 12.1 Create src/tracing/otel.ts: OpenTelemetry SDK setup, TracerProvider, configurable OTLP endpoint
- [ ] 12.2 Create src/tracing/exporters.ts: EDOT Collector OTLP/HTTP exporter, LangSmith exporter
- [ ] 12.3 Create src/tracing/spans.ts: withRunSpan, withSuiteSpan, withTestSpan, withToolCallSpan, withLlmCallSpan, withEvaluatorSpan helpers
- [ ] 12.4 Add eval.* attribute namespace to all spans for dashboard compatibility
- [ ] 12.5 Wire tracing into test runner, agent loop, and evaluators
- [ ] 12.6 Write tests for span creation and attribute setting

## 13. Reporting

- [ ] 13.1 Create src/reporting/terminal.ts: formatted tables with pass/fail per test and evaluator, color-coded, summary line
- [ ] 13.2 Create src/reporting/markdown.ts: generate markdown report with suite results, evaluator scores, failure details
- [ ] 13.3 Create src/reporting/es-export.ts: bulk-index evaluation score documents to kibana-evaluations datastream
- [ ] 13.4 Implement failure clustering: classify failures into categories (wrong tool, wrong args, timeout, error, hallucination)
- [ ] 13.5 Implement JSON output via --output flag

## 14. Test Runner (Orchestrator)

- [ ] 14.1 Create src/core/runner.ts: route suites to correct layer handler based on suite.layer
- [ ] 14.2 Implement McpPluginClient lifecycle: one connection per suite, disconnect after suite
- [ ] 14.3 Implement concurrency control: p-limit with configurable parallelism per layer
- [ ] 14.4 Implement repetitions: repeat LLM eval tests, aggregate scores
- [ ] 14.5 Implement setup/teardown orchestration at suite and test level
- [ ] 14.6 Implement result aggregation: compute pass rates per suite, per evaluator, overall
- [ ] 14.7 Implement --ci mode: enforce thresholds, exit non-zero on failure
- [ ] 14.8 Wire runner into CLI run subcommand

## 15. Initial Test Suites for elastic-cursor-plugin

- [ ] 15.1 Create plugin-eval.yaml with plugin config pointing to elastic-cursor-plugin
- [ ] 15.2 Write gateway-tools suite: elasticsearch_api GET, esql_query, kibana_api, cloud_api error
- [ ] 15.3 Write security-operations suite: manage_detection_rules CRUD, triage_alerts list+update, manage_cases create+attach
- [ ] 15.4 Write discovery-workflows suite: discover_data -> get_cluster_context round-trip, discover_security_data
- [ ] 15.5 Write agent-tool-selection suite (LLM layer): prompts for common user requests, expected tool selections
- [ ] 15.6 Write error-handling suite: missing auth, invalid args, connection refused
- [ ] 15.7 Create scripts/seed-security-data.js for populating test cluster with sample data

## 16. Documentation

- [ ] 16.1 Write README.md with quick start, architecture overview, CLI reference
- [ ] 16.2 Write CONTRIBUTING.md with development setup, testing guide, architecture notes
- [ ] 16.3 Add inline JSDoc comments to public API surfaces
