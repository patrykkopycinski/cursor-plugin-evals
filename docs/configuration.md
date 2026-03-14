# Configuration Reference

Complete reference for the `plugin-eval.yaml` configuration file.

## Minimal Config

```yaml
plugin:
  name: my-plugin
  dir: ./my-plugin

suites:
  - name: smoke
    layer: static
    tests:
      - name: valid-manifest
        check: manifest
```

## plugin

Connection and build settings for your MCP plugin.

```yaml
plugin:
  name: my-plugin
  dir: ./my-plugin
  entry: node dist/index.js
  plugin_root: .cursor-plugin
  build_command: npm run build
  transport: stdio           # stdio | http | sse | streamable-http
  url: http://localhost:3000 # required for http/sse/streamable-http
  headers:
    Authorization: "Bearer ${API_TOKEN}"
  auth:
    type: oauth2             # api-key | bearer | oauth2
    token_url: https://auth.example.com/oauth/token
    client_id: ${OAUTH_CLIENT_ID}
    client_secret: ${OAUTH_CLIENT_SECRET}
    scopes: [read, write]
  env:
    MY_SERVICE_URL: ${MY_SERVICE_URL}
    MY_API_KEY: ${MY_API_KEY}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | *required* | Plugin identifier |
| `dir` | string | `.` | Plugin directory path |
| `entry` | string | — | Command to start the MCP server (stdio transport) |
| `plugin_root` | string | — | Relative path from `dir` to the plugin root (e.g. `.cursor-plugin`) |
| `build_command` | string | — | Build command to run before connecting |
| `transport` | string | `stdio` | Transport type: `stdio`, `http`, `sse`, `streamable-http` |
| `url` | string | — | Server URL for non-stdio transports |
| `headers` | map | — | HTTP headers for non-stdio transports |
| `auth` | object | — | Authentication config (see [OAuth docs](./oauth.md)) |
| `env` | map | — | Environment variables passed to the server process |

## defaults

Default settings applied to all suites unless overridden.

```yaml
defaults:
  timeout: 30000
  repetitions: 3
  judge_model: gpt-5.4
  thresholds:
    tool-selection: 0.8
    tool-args: 0.7
    response-quality: 0.7
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | number | `30000` | Max milliseconds per test |
| `repetitions` | number | `1` | How many times to repeat each test |
| `judge_model` | string | `gpt-5.4` | LLM model used by LLM evaluators |
| `thresholds` | map | — | Per-evaluator pass/fail thresholds (0–1) |

## scoring

Weights for the five quality dimensions that produce the composite score.

```yaml
scoring:
  weights:
    tool_accuracy: 0.30
    response_quality: 0.25
    efficiency: 0.15
    security: 0.15
    reliability: 0.15
```

All weights must sum to 1.0. The composite score determines the letter grade (A–F) shown in reports and badges.

## guardrails

Pattern-based rules that block, warn, or log tool calls during evaluation.

```yaml
guardrails:
  - name: block-delete-all
    pattern: "DELETE.*/_all|_delete_by_query"
    action: block
    message: "Blocked destructive DELETE operation"
  - name: warn-write-ops
    pattern: "PUT|POST.*/_bulk"
    action: warn
  - name: log-admin
    pattern: "_cluster|_nodes"
    action: log
```

See [Guardrails](./guardrails.md) for details on actions and default rules.

## ci

Thresholds enforced when running with `--ci`. The run exits non-zero if any threshold is violated.

```yaml
ci:
  score:
    avg: 0.8
    min: 0.5
    p95: 0.75
  latency:
    avg: 5000
    p95: 10000
  cost:
    max: 0.50
  evaluators:
    tool-selection:
      avg: 0.85
      min: 0.6
    response-quality:
      avg: 0.7
  required_pass:
    - smoke-test
    - critical-workflow
```

| Field | Type | Description |
|-------|------|-------------|
| `score.avg/min/max/p50/p95/p99` | number | Aggregate score thresholds |
| `latency.avg/p95` | number | Latency thresholds in milliseconds |
| `cost.max` | number | Maximum cost in USD per run |
| `evaluators.<name>.avg/min/max` | number | Per-evaluator thresholds |
| `required_pass` | string[] | Test names that must pass regardless of score |

## notifications

Configure where results are sent after each run.

```yaml
notifications:
  slack:
    webhook_url: ${SLACK_WEBHOOK_URL}
  github:
    token: ${GITHUB_TOKEN}
    repo: owner/repo
  webhook:
    url: https://hooks.example.com/eval
    headers:
      X-Api-Key: ${WEBHOOK_KEY}
  triggers:
    - on: failure
    - on: score_drop
      threshold: 0.05
```

See [Notifications](./notifications.md) for full details.

## suites

Array of test suites. Each suite has a name, layer, and list of tests.

```yaml
suites:
  - name: plugin-structure
    layer: static
    tests:
      - name: valid-manifest
        check: manifest

  - name: tool-calls
    layer: integration
    require_env: [MY_SERVICE_URL]
    adapter: mcp
    tests:
      - name: search
        tool: search_tool
        args: { query: "list items" }
        assert:
          - field: content[0].text
            op: contains
            value: "item"
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Suite identifier |
| `layer` | string | `static`, `unit`, `integration`, `llm`, `performance`, `skill` |
| `require_env` | string[] | Skip suite if any listed env var is unset |
| `adapter` | string or string[] | Task adapter(s) for skill layer |
| `setup` | string | Shell command to run before the suite |
| `teardown` | string | Shell command to run after the suite |
| `defaults` | object | Suite-level overrides for timeout/repetitions/thresholds |
| `tests` | array | Test definitions (shape depends on layer) |

## Environment Variable Interpolation

Use `${VAR_NAME}` syntax anywhere in the YAML to reference environment variables:

```yaml
plugin:
  env:
    SERVICE_URL: ${SERVICE_URL}
    API_KEY: ${MY_API_KEY}
```

Unresolved variables are left as empty strings. Combine with `require_env` on suites to skip tests when variables are missing.

## See Also

- [Getting Started](./getting-started.md)
- [CI/CD Integration](./ci-cd.md)
- [Guardrails](./guardrails.md)
- [Notifications](./notifications.md)
