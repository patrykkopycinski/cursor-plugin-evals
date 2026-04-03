# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Architecture

- **Single source of truth**: All branding/naming constants (`SERVICE_NAME`, `DATA_DIR`, `CLI_NAME`, `REPO_URL`) centralized in `core/constants.ts` — renaming the project changes one file
- **CLI modularization**: Split `cli/main.ts` (2,785 lines) into 11 focused command group modules under `cli/commands/` (~260 lines each); main.ts reduced to 55-line orchestrator
- **MCP server modularization**: Split `mcp/server.ts` (1,282 lines) into `tool-definitions.ts`, `tool-handlers.ts`, and `resource-handlers.ts`; server.ts reduced to 44-line setup
- **Dynamic imports in runner**: All non-core dependencies in `core/runner.ts` (evaluators, tracing, scoring, CI, MCP) are now lazy-loaded via `await import()` for faster CLI startup
- **MCP coupling removed**: Extracted `buildConnectConfig` from `core/utils.ts` into `mcp/connect.ts` to keep core free of MCP dependencies
- **ToolCaller interface**: Extracted minimal `{ callTool }` interface replacing direct `McpPluginClient` dependency in performance runner
- **Types split**: Monolithic `core/types.ts` split into sub-modules (adapter, common, config, evaluator, plugin, result)

### Code Quality

- **Zero `as any`**: Eliminated all 9 `as any` casts from production code with proper types
- **`node:` protocol**: Standardized all ~66 files from bare builtin imports (`fs`, `path`, etc.) to `node:` protocol
- **Catch blocks**: All 129 empty `catch {}` blocks replaced with `catch (_e) {}` for explicit error acknowledgment
- **Test coverage**: Added 327 new tests (1,443 → 1,770) across new and refactored modules
- **MCP tools**: 14 → 17 tools (added `evaluate_trace`, `harvest_traces`, `deploy_dashboard`)

## [0.0.1] - 2026-03-12

Initial release of the cursor-plugin-evals framework.

### Core Framework
- Six testing layers: static, unit, integration, performance, LLM eval, skill eval
- YAML and TypeScript (Expect API) suite definitions
- Concurrent test runner with suite routing, aggregation, and watch mode
- Plugin discovery and manifest parsing
- MCP client with four transports (stdio, HTTP, SSE, streamable-HTTP)
- Authentication providers (API key, bearer, OAuth2)
- Interactive `setup` wizard — checks prerequisites, auto-fixes what it can, and prints guided next steps

### Evaluators
- 13 deterministic (CODE) evaluators: tool-selection, tool-args, tool-sequence, response-quality, path-efficiency, cluster-state, mcp-protocol, security, tool-poisoning, skill-trigger, content-quality, keywords, rag (Precision@K/Recall@K/F1@K)
- 7 LLM-as-judge evaluators: correctness, groundedness, g-eval, similarity, context-faithfulness, conversation-coherence, criteria
- Evaluator name pattern matching (wildcard RAG metric patterns)
- Configurable LLM judge model via `JUDGE_MODEL` and `LITELLM_URL`

### Task Adapters
- 7 pluggable adapters: mcp, plain-llm, headless-coder, gemini-cli, claude-sdk, cursor-cli, otel-trace
- Dynamic import with adapter factory caching
- Per-suite adapter selection (single or multiple)

### Skill Evaluation
- eval.yaml dataset loader with per-example overrides
- Multi-adapter execution with evaluator routing
- Repetition support for statistical confidence

### CI Integration
- Structured CI thresholds: score percentiles, latency, cost, per-evaluator
- Direction-aware violation reporting (< for scores, > for latency/cost)
- `ci-init` scaffolding for GitHub Actions, GitLab CI, and shell scripts
- JUnit XML report output for CI integration

### Model Comparison
- Multi-model experiment execution
- Comparison matrix with per-test scores and model aggregates
- Formatted table output and JSON export

### Skill Collision Detection
- Skill directory scanner with SKILL.md parsing
- TF-IDF content similarity and Jaccard tool overlap
- Verdict classification (ok/warn/error) with recommendations

### Token & Cost Tracking
- Pricing catalog for 11 models (GPT-4o/mini/turbo, Claude Sonnet/Opus/Haiku, Gemini Pro/Flash)
- Per-test cost calculation from token usage
- Cost thresholds in CI enforcement

### Quality Score
- Five-dimension scoring: structure, correctness, security, performance, agent readiness
- Composite score (0-100) with letter grade (A-F)
- Configurable dimension weights
- SVG badge generation

### Reporting
- Five output formats: terminal, markdown, JSON, HTML, JUnit XML
- Web dashboard with Hono + SQLite (run history, suite drill-down, quality trends)
- Elasticsearch datastream export
- OTel tracing with spans and exporters
- Failure clustering with recommended actions per category

### Fixture System
- Record/replay MCP tool calls with compressed JSONL (.jsonl.gz)
- SHA-256 argument hashing for fixture matching
- Mock MCP server generation from recorded fixtures
- Recording repository for storing and replaying full eval runs

### Infrastructure
- LLM response cache with disk persistence, configurable TTL, hit/miss stats
- Dataset generator for programmatic test case creation from JS/TS modules
- Security lint: 4 static checks on skill files (credentials, scope, data, hygiene)

### CLI
- 18 commands: run, init, setup, score, discover, doctor, dashboard, collections, ci-init, mock-gen, skill-eval, collision-check, compare, replay, history, env, security-lint, record

### Cursor Integration
- 5 skills: run-plugin-evals, debug-eval-failure, write-eval-suite, record-fixtures, eval-doctor
- 5 commands: /eval:run, /eval:debug, /eval:write, /eval:record, /eval:doctor
- 3 rules: framework-conventions, eval-suite-guidelines, mcp-client-patterns
