# plugin-eval.yaml Schema Reference

Complete field reference for the cursor-plugin-evals configuration file. All field names must be **snake_case** — the framework converts them to camelCase internally after Zod validation.

---

## Top-Level Structure

```yaml
plugin:         # Required — plugin identification and connection
infrastructure: # Optional — backing services (Docker, ES)
tracing:        # Optional — observability endpoints
defaults:       # Optional — shared test defaults
scoring:        # Optional — layer weight overrides
plugins:        # Optional — custom evaluator/reporter/transport plugins
ci:             # Optional — CI quality gate thresholds
guardrails:     # Optional — runtime safety rules
post_run:       # Optional — hooks after eval runs
derived_metrics: # Optional — computed metrics from raw scores
suites:         # Required — array of test suites
```

---

## `plugin` (required)

Identifies the plugin under test and how to connect to its MCP server.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | **yes** | — | Plugin name (for display and identification) |
| `dir` | string | no | `$PLUGIN_DIR` | Directory containing the plugin source. Falls back to `PLUGIN_DIR` env var |
| `entry` | string | no | — | Path to the MCP server entry point (e.g., `dist/index.js`). Required for integration + performance layers |
| `plugin_root` | string | no | — | Root directory of the plugin (for resolving relative paths) |
| `build_command` | string | no | — | Command to build the plugin before testing (e.g., `npm run build`) |
| `env` | map[string, string] | no | — | Environment variables forwarded to the MCP server process |
| `transport` | enum | no | `stdio` | Transport type: `stdio`, `http`, `sse`, `streamable-http` |
| `url` | string | no | — | Server URL. **Required** when transport is `http`, `sse`, or `streamable-http` |
| `headers` | map[string, string] | no | — | Custom HTTP headers for non-stdio transports |
| `auth` | object | no | — | Authentication config (see below) |

### `plugin.auth` variants

**API Key auth:**
```yaml
auth:
  type: api-key
  key: "${MY_API_KEY}"
  header: X-API-Key      # optional, default: Authorization
  prefix: Bearer          # optional
```

**Bearer token auth:**
```yaml
auth:
  type: bearer
  token: "${MY_TOKEN}"
```

**OAuth2 client credentials:**
```yaml
auth:
  type: oauth2
  token_url: https://auth.example.com/token
  client_id: "${CLIENT_ID}"
  client_secret: "${CLIENT_SECRET}"
  scopes: [read, write]  # optional
```

---

## `infrastructure` (optional)

| Field | Type | Description |
|---|---|---|
| `docker_compose` | string | Path to docker-compose.yml for backing services |
| `obs_es_url` | string | Elasticsearch URL for observability data |

---

## `tracing` (optional)

| Field | Type | Description |
|---|---|---|
| `otel_endpoint` | string | OpenTelemetry collector endpoint |
| `langsmith_project` | string | LangSmith project name for trace export |

---

## `defaults` (optional)

Shared defaults applied to all tests unless overridden at the suite or test level.

| Field | Type | Default | Description |
|---|---|---|---|
| `timeout` | number | — | Test timeout in milliseconds |
| `judge_model` | string | — | LLM model for evaluator judges (e.g., `gpt-4.1`) |
| `repetitions` | number | — | Number of times to repeat each test |
| `thresholds` | map[string, number or object] | — | Per-evaluator configuration. Keys are evaluator names, values are threshold numbers or config objects |

---

## `scoring` (optional)

| Field | Type | Description |
|---|---|---|
| `weights` | map[string, number] | Weight per layer/evaluator name. Values must be ≤ 1.0 |

```yaml
scoring:
  weights:
    static: 0.5
    unit: 0.8
    integration: 1.0
    llm: 1.0
    performance: 0.5
```

---

## `plugins` (optional)

Register custom evaluators, reporters, or transports.

| Field | Type | Description |
|---|---|---|
| `evaluators` | array of `{name, module}` | Custom evaluator plugins |
| `reporters` | array of `{name, module}` | Custom report format plugins |
| `transports` | array of `{name, module}` | Custom MCP transport plugins |

---

## `ci` (optional)

CI quality gate thresholds. `npx cursor-plugin-evals run --ci` uses these to determine exit code.

| Field | Type | Description |
|---|---|---|
| `score.avg` | number | Minimum average score across all tests |
| `score.min` | number | Minimum individual test score |
| `score.max` | number | Maximum score cap |
| `score.p50` | number | 50th percentile score threshold |
| `score.p95` | number | 95th percentile score threshold |
| `score.p99` | number | 99th percentile score threshold |
| `latency.avg` | number | Maximum average latency (ms) |
| `latency.p95` | number | Maximum p95 latency (ms) |
| `cost.max` | number | Maximum cost per run |
| `evaluators` | map[string, {avg?, min?, max?}] | Per-evaluator score thresholds |
| `required_pass` | string[] | Suite names that must pass (exit 1 if any fail) |
| `first_try_pass_rate` | number | Minimum proportion of tests passing on first attempt |
| `phase_gate` | object | Phase-level gate (see below) |

### `ci.phase_gate`

| Field | Type | Description |
|---|---|---|
| `first_try_pass_rate` | number | Minimum first-try pass rate for the phase |
| `e2e_completion_rate` | number | Minimum end-to-end completion rate |
| `description` | string | Human-readable description of the phase gate |

```yaml
ci:
  score:
    avg: 0.80
  required_pass: [security, tool-poisoning, mcp-protocol]
  first_try_pass_rate: 0.75
  evaluators:
    security:
      min: 1.0
    correctness:
      avg: 0.7
```

---

## `guardrails` (optional)

Runtime safety rules evaluated during test execution.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Rule identifier |
| `pattern` | string | yes | Regex pattern to match against |
| `action` | enum | yes | `block`, `warn`, or `log` |
| `message` | string | no | Human-readable message when triggered |

---

## `post_run` (optional)

Hooks executed after an eval run completes.

**Webhook:**
```yaml
post_run:
  - type: webhook
    url: https://hooks.example.com/eval-results
    template: slack          # optional
    headers:                 # optional
      Authorization: "Bearer ${HOOK_TOKEN}"
```

**Script:**
```yaml
post_run:
  - type: script
    command: node scripts/report.js
    pass_env: [CI, GITHUB_SHA]  # optional
```

---

## `derived_metrics` (optional)

Computed metrics from raw evaluator scores.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Metric name |
| `formula` | string | yes | JS expression using evaluator names as variables |
| `threshold` | number | no | Minimum acceptable value (0-1) |

---

## `suites` (required)

Array of test suites. Each entry can be:
1. An **inline suite object** (most common)
2. A **collection reference**: `{ collection: "collection-name" }`
3. A **YAML file path**: `"suites/security.yaml"`
4. A **TypeScript/JavaScript file path**: `"suites/custom.ts"`
5. A **glob pattern**: `"suites/*.yaml"`

### Suite Object

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | **yes** | — | Suite identifier |
| `layer` | enum | **yes** | — | `unit`, `static`, `integration`, `llm`, `performance`, `skill` |
| `adapter` | string or string[] | no | — | Adapter name(s): `plain-llm`, `cursor-cli`, `mcp`, etc. |
| `setup` | string | no | — | Setup command to run before the suite |
| `teardown` | string | no | — | Teardown command to run after the suite |
| `defaults` | object | no | — | Suite-level defaults (same shape as top-level `defaults`) |
| `tests` | array | **yes** | — | Array of test cases (schema depends on layer) |
| `skill_dir` | string | no | — | Directory containing the skill under test |
| `skill_path` | string | no | — | Path to the specific skill file |
| `require_env` | string[] | no | — | Environment variables required; suite skipped if any are missing |
| `evaluators` | object | no | — | Suite-level evaluator overrides: `{add?, remove?, override?}` |
| `test_filter` | object | no | — | `{adapters?: string[]}` — only run tests with matching adapter |
| `matrix` | map[string, array] | no | — | Matrix of parameter combinations for test expansion |

---

## Test Schemas by Layer

### Unit tests (`layer: unit`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Test name |
| `difficulty` | enum | no | `simple`, `moderate`, `complex`, `adversarial` |
| `check` | enum | **yes** | `registration`, `schema`, `conditional_registration`, `response_format` |
| `expected_tools` | string[] | no | Tools expected to be registered |
| `tool` | string | no | Specific tool to test |
| `args` | map | no | Arguments to pass to the tool |
| `env` | map[string, string] | no | Environment variables for this test |
| `minimal_env` | map[string, string] | no | Minimal env for conditional registration |

### Static tests (`layer: static`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Test name |
| `difficulty` | enum | no | `simple`, `moderate`, `complex`, `adversarial` |
| `check` | enum | **yes** | One of: `manifest`, `skill_frontmatter`, `rule_frontmatter`, `agent_frontmatter`, `command_frontmatter`, `hooks_schema`, `mcp_config`, `component_references`, `cross_component_coherence`, `naming_conventions`, `skill_content_quality`, `skill_reference_files` |
| `components` | string[] | no | Specific component paths to check |

### Integration tests (`layer: integration`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Test name |
| `difficulty` | enum | no | `simple`, `moderate`, `complex`, `adversarial` |
| `tool` | string | **yes** | MCP tool to invoke |
| `args` | map | no | Arguments for the tool call (default: `{}`) |
| `assert` | array | no | Array of assertion objects |
| `setup` | string | no | Setup command |
| `teardown` | string | no | Teardown command |
| `workflow` | array | no | Multi-step workflow (array of workflow steps) |
| `expect_error` | boolean | no | If true, expect the tool to return an error |
| `require_env` | string[] | no | Required environment variables |

### Integration assertions

```yaml
assert:
  - field: content.0.text    # Dot-notation path into the result
    op: contains              # Assertion operator
    value: "green"            # Expected value (depends on op)
```

**Assertion operators**: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `not_contains`, `exists`, `not_exists`, `length_gte`, `length_lte`, `type`, `matches`, `one_of`, `starts_with`, `ends_with` — plus `not_<op>` variants.

### LLM tests (`layer: llm`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Test name |
| `difficulty` | enum | no | `simple`, `moderate`, `complex`, `adversarial` |
| `type` | enum | no | `single` (default), `conversation` |
| `prompt` | string | **yes** | Natural language prompt |
| `expected` | object | **yes** | Expected output (see Expected Output below) |
| `evaluators` | string[] | **yes** | List of evaluator names to run |
| `max_turns` | number | no | Maximum agent turns |
| `models` | string[] | no | Specific models to test against |
| `system` | string | no | Custom system prompt |
| `turns` | array | no | Multi-turn conversation turns |
| `distractors` | object | no | `{mode: "random"|"targeted"|"none", count?: number}` |

### Expected Output Object

Used in LLM tests and conversation turns:

| Field | Type | Description |
|---|---|---|
| `tools` | string[] | Expected tool names |
| `tool_args` | map[string, map[string, any]] | Expected arguments per tool |
| `tool_sequence` | string[] | Expected order of tool calls |
| `golden_path` | string[] | Ideal tool call sequence for efficiency scoring |
| `response_contains` | string[] | Strings that must appear in the response |
| `response_not_contains` | string[] | Strings that must NOT appear |
| `cluster_state` | array | Cluster state assertions (for cluster-state evaluator) |
| `esql_golden` | string | Reference ES|QL query for result comparison (for esql-result evaluator) |

### Performance tests (`layer: performance`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Test name |
| `difficulty` | enum | no | `simple`, `moderate`, `complex`, `adversarial` |
| `tool` | string | **yes** | MCP tool to benchmark |
| `args` | map | no | Arguments (default: `{}`) |
| `warmup` | number | no | Warmup iterations before measuring |
| `iterations` | number | no | Number of measured iterations |
| `concurrency` | number | no | Parallel request count |
| `thresholds` | object | no | `{p50?, p95?, p99?}` — latency thresholds in ms |
| `require_env` | string[] | no | Required environment variables |

---

## Environment Variable Interpolation

Use `${VAR_NAME}` syntax to reference environment variables. The framework does a simple lookup — `process.env[VAR_NAME]`.

```yaml
plugin:
  env:
    ES_URL: "${ES_URL}"
    ES_API_KEY: "${ES_API_KEY}"
```

**No bash-style defaults.** `${VAR:-default}` is NOT supported — it will throw `Unresolved environment variable`. Set defaults in `.env.test` instead.

---

## Workflow Steps (Integration)

For multi-step integration tests using the `workflow` field:

| Field | Type | Required | Description |
|---|---|---|---|
| `tool` | string | yes | MCP tool to call |
| `args` | map | no | Arguments (default: `{}`) |
| `output` | string | no | Variable name to capture the result |
| `assert` | array | no | Assertions on this step's result |

---

## Complete Example

```yaml
plugin:
  name: my-elastic-plugin
  dir: .
  entry: dist/index.js
  build_command: npm run build
  env:
    ES_URL: "${ES_URL}"
    ES_API_KEY: "${ES_API_KEY}"

defaults:
  timeout: 30000
  judge_model: gpt-4.1

scoring:
  weights:
    static: 0.5
    unit: 0.8
    integration: 1.0
    llm: 1.0
    performance: 0.5

ci:
  score:
    avg: 0.80
  required_pass: [security, tool-poisoning]
  first_try_pass_rate: 0.75
  evaluators:
    security:
      min: 1.0

suites:
  - name: unit-tools
    layer: unit
    tests:
      - name: all tools registered
        check: registration
        expected_tools: [elasticsearch_api, esql_query]

  - name: integration-happy
    layer: integration
    require_env: [ES_URL]
    tests:
      - name: cluster health
        tool: elasticsearch_api
        args:
          method: GET
          path: /_cluster/health
        assert:
          - field: content.0.text
            op: contains
            value: "green"

  - name: llm-tool-selection
    layer: llm
    tests:
      - name: natural language query
        prompt: "What is the cluster health status?"
        expected:
          tools: [elasticsearch_api]
          response_contains: [health, status]
        evaluators: [tool-selection, correctness, keywords]

  - name: performance-bench
    layer: performance
    require_env: [ES_URL]
    tests:
      - name: health check latency
        tool: elasticsearch_api
        args:
          method: GET
          path: /_cluster/health
        iterations: 20
        warmup: 3
        thresholds:
          p50: 200
          p95: 500
```
