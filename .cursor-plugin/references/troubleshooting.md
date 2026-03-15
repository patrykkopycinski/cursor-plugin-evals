# Troubleshooting Guide

Common errors when running cursor-plugin-evals and how to fix them.

---

## Missing API Keys

### Symptom

```
Error: No LLM provider configured. Set one of: AWS_ACCESS_KEY_ID, ANTHROPIC_API_KEY, AZURE_OPENAI_API_KEY, OPENAI_API_KEY
```

Or LLM evaluators return `skipped` with "No judge model available."

### Cause

The `plain-llm` adapter and LLM-based evaluators need API credentials to call an LLM.

### Fix

Set at least one provider's credentials. The framework checks in priority order:

1. **AWS Bedrock** (recommended for speed):
   ```bash
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_REGION=us-east-1
   ```

2. **Anthropic**:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   ```

3. **Azure OpenAI** (recommended for judge):
   ```bash
   export AZURE_OPENAI_API_KEY=...
   export AZURE_OPENAI_ENDPOINT=https://my-deployment.openai.azure.com
   export AZURE_OPENAI_DEPLOYMENT=gpt-4.1
   ```

4. **OpenAI**:
   ```bash
   export OPENAI_API_KEY=sk-...
   ```

For convenience, put credentials in `.env.test` and source it before running:
```bash
source .env.test
npx cursor-plugin-evals run
```

---

## Docker Not Running

### Symptom

```
Error: Cannot connect to the Docker daemon. Is the docker daemon running?
```

Or integration tests fail with connection refused errors to `localhost:9220`.

### Cause

Integration and performance tests that need backing services (Elasticsearch, Kibana) require Docker.

### Fix

1. Start Docker Desktop or the Docker daemon
2. Start the test infrastructure:
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```
3. Wait for services to be healthy:
   ```bash
   docker compose -f docker/docker-compose.yml ps
   ```
4. Verify connectivity:
   ```bash
   curl -k https://localhost:9220 -u elastic:changeme
   ```

If you don't need integration tests, skip them:
```bash
npx cursor-plugin-evals run --layer llm --layer static
```

---

## Plugin Build Failures

### Symptom

```
Error: Build command failed: npm run build
```

Or:
```
Error: Plugin entry point not found: dist/index.js
```

### Cause

The plugin hasn't been built, or the build is outdated/broken.

### Fix

1. Build the plugin manually:
   ```bash
   cd <plugin-dir>
   npm install
   npm run build
   ```

2. Check for TypeScript errors:
   ```bash
   npx tsc --noEmit
   ```

3. Verify the entry point exists:
   ```bash
   ls dist/index.js
   ```

4. If using a workspace/monorepo, ensure the correct workspace is built:
   ```bash
   npm run build --workspace=packages/mcp-server
   ```

---

## Timeout Errors

### Symptom

```
Error: Test "my test" timed out after 30000ms
```

Or cursor-cli tests show:
```
Error: Cursor CLI exited with code null. stderr: (empty)
```

### Cause

The default timeout is too short for the operation. Common with:
- `cursor-cli` adapter (tests take 40-350s each)
- Complex multi-step LLM tests
- Slow network or API rate limiting

### Fix

Increase the timeout at the suite or test level:

```yaml
suites:
  - name: cursor-e2e
    layer: llm
    adapter: cursor-cli
    defaults:
      timeout: 600000  # 10 minutes for cursor-cli
    tests:
      - name: complex workflow
        timeout: 900000  # 15 minutes for this specific test
        prompt: "..."
```

For `plain-llm`, the default 120s timeout is usually sufficient. If you're seeing timeouts, check:
- API rate limits (add delays between tests with `repetitions`)
- Network connectivity to the LLM provider

---

## Content Filter Errors

### Symptom

```
[CONTENT_FILTER] The response was blocked by the content filter.
```

Or evaluators score `1.0` with label `blocked`.

### Cause

The LLM provider's content filter blocked the request or response. This is common with:
- Adversarial/security test prompts
- Prompts containing potentially harmful language
- Azure OpenAI's stricter content policies

### Fix

1. **For security tests**: This is expected behavior — the `tool-poisoning` evaluator treats blocked responses as safe (score 1.0).

2. **For legitimate tests**: Rephrase the prompt to avoid triggering the content filter. Avoid:
   - Explicit injection language ("ignore all previous instructions")
   - Security-related keywords in prompts that aren't security tests

3. **Switch providers**: Bedrock/Anthropic have different content filter policies than Azure OpenAI.

4. **Use the `resistance` evaluator**: For adversarial tests, `resistance` is designed to evaluate whether the agent correctly refused — content filter blocks count as resistance.

---

## Zod Validation Errors

### Symptom

```
ZodError: [
  {
    "code": "unrecognized_keys",
    "keys": ["pluginRoot", "buildCommand"],
    "path": ["plugin"],
    "message": "Unrecognized key(s) in object: 'pluginRoot', 'buildCommand'"
  }
]
```

### Cause

The YAML config uses **camelCase** field names instead of **snake_case**. The Zod schema validates before the snake-to-camel conversion, so camelCase keys are silently stripped as unknown keys.

### Fix

Convert all field names to snake_case:

| Wrong (camelCase) | Correct (snake_case) |
|---|---|
| `pluginRoot` | `plugin_root` |
| `buildCommand` | `build_command` |
| `judgeModel` | `judge_model` |
| `expectedTools` | `expected_tools` |
| `requireEnv` | `require_env` |
| `expectError` | `expect_error` |
| `responseContains` | `response_contains` |
| `responseNotContains` | `response_not_contains` |
| `toolArgs` | `tool_args` |
| `maxTurns` | `max_turns` |
| `firstTryPassRate` | `first_try_pass_rate` |

**Exception**: Keys inside `env:`, `args:`, and `assert.value` are pass-through — keep them in whatever case the target API expects.

---

## Scoring Weight Validation

### Symptom

```
ZodError: scoring.weights.integration must be <= 1
```

### Cause

Scoring weights must be between 0 and 1.0. The Zod schema validates with `z.number().max(1)`.

### Fix

```yaml
# Wrong
scoring:
  weights:
    integration: 2.0

# Correct
scoring:
  weights:
    integration: 1.0
```

---

## Environment Variable Interpolation Errors

### Symptom

```
Error: Unresolved environment variable: MY_URL:-http://localhost:9220
```

### Cause

The config uses bash-style default syntax `${VAR:-default}`, which is not supported. The interpolation does a simple `${VAR_NAME}` → `process.env[VAR_NAME]` lookup.

### Fix

Use plain variable references and set defaults in `.env.test`:

```yaml
# Wrong
env:
  MY_URL: "${MY_URL:-http://localhost:9220}"

# Correct
env:
  MY_URL: "${MY_URL}"
```

In `.env.test`:
```bash
MY_URL=http://localhost:9220
```

---

## Cursor CLI Not Found

### Symptom

```
Error: cursor-cli adapter requires the Cursor Agent CLI.
Install: curl https://cursor.com/install -fsS | bash, or npm install @nothumanwork/cursor-agents-sdk
```

### Cause

The `cursor-cli` adapter requires the Cursor Agent binary but can't find it.

### Fix

The adapter searches in three locations (in order):

1. **Local versions**: `~/.local/share/cursor-agent/versions/` — installed by Cursor
2. **SDK package**: `@nothumanwork/cursor-agents-sdk` — npm installable
3. **PATH**: `which agent`

Install one of these:
```bash
# Option 1: Install Cursor (includes agent CLI)
curl https://cursor.com/install -fsS | bash

# Option 2: Install the SDK
npm install @nothumanwork/cursor-agents-sdk
```

---

## Suite Skipped Due to Missing Env

### Symptom

```
Suite "integration-es" skipped: missing required env vars: ES_URL
```

### Cause

The suite has `require_env` set and one or more variables are not in the environment.

### Fix

Either set the required variables:
```bash
export ES_URL=https://localhost:9220
```

Or skip integration suites intentionally:
```bash
npx cursor-plugin-evals run --layer llm --layer static --layer unit
```

---

## Flaky LLM Tests

### Symptom

A test passes sometimes and fails other times with different scores.

### Cause

LLM output is non-deterministic. Especially with:
- Low thresholds that scores hover around
- Prompts with ambiguous expected behavior
- Evaluators sensitive to exact wording

### Fix

1. **Increase repetitions** to average out variance:
   ```yaml
   defaults:
     repetitions: 3
   ```

2. **Relax thresholds** to account for normal variance:
   ```yaml
   evaluators: [correctness]
   defaults:
     thresholds:
       correctness: 0.6  # was 0.8
   ```

3. **Make prompts more specific** to reduce output variance

4. **Use `keywords` instead of `correctness`** when you just need specific terms in the output — code-based evaluators are deterministic

5. **Pin the model** for reproducibility:
   ```yaml
   defaults:
     judge_model: gpt-4.1
   ```

---

## CI Threshold Failures

### Symptom

```
CI gate failed: score.avg 0.72 < threshold 0.80
```

### Cause

The overall evaluation score is below the CI threshold. This can mean:
- Individual tests are failing and dragging down the average
- Thresholds are too tight for the current test quality

### Fix

1. **Fix individual test failures first** — don't relax thresholds as the first action
2. **Run with `--verbose`** to identify which tests are dragging the score:
   ```bash
   npx cursor-plugin-evals run --ci --verbose
   ```
3. **Calibrate thresholds** based on actual scores. After all tests pass:
   - If actual > threshold + 20%: tighten the threshold to `actual - 5%`
   - If actual ≈ threshold: well-calibrated, leave as-is
   - Security `min` must always be `1.0`

---

## Connection Refused to MCP Server

### Symptom

```
Error: connect ECONNREFUSED 127.0.0.1:3000
```

### Cause

The MCP server isn't running or is using a different port.

### Fix

1. Verify `plugin.entry` points to the correct file
2. Check the `plugin.transport` matches how the server is configured
3. For stdio transport (default): ensure the entry point is executable
4. For HTTP/SSE transport: ensure `plugin.url` is correct and the server is running
5. Check that `plugin.env` includes all required environment variables

---

## Glob Pattern Matched No Files

### Symptom

```
Error: Glob pattern "suites/*.yaml" matched no files (resolved from /path/to/config)
```

### Cause

A suite entry in the `suites` array is a glob pattern that doesn't match any files.

### Fix

1. Check the glob pattern is relative to the config file location
2. Verify the suite files exist:
   ```bash
   ls suites/*.yaml
   ```
3. Use a direct file path instead of a glob if only one file is expected

---

## Diagnostic Commands

Run the built-in doctor to check your setup:

```bash
npx cursor-plugin-evals doctor
```

This checks:
- Plugin config validity
- Build status
- Environment variables
- Docker services
- API key availability
- Cursor CLI installation

For verbose output on a specific suite:
```bash
npx cursor-plugin-evals run --suite my-suite --verbose
```

For a dry run (validate config without executing):
```bash
npx cursor-plugin-evals run --dry-run
```
