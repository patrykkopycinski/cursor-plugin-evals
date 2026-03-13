<p align="center">
  <img src="assets/banner.svg" alt="cursor-plugin-evals" width="100%" />
</p>

<p align="center">
  <a href="#six-testing-layers"><img src="https://img.shields.io/badge/layers-6-6C5CE7?style=flat-square" alt="6 Layers" /></a>
  <a href="#evaluators"><img src="https://img.shields.io/badge/evaluators-22-A29BFE?style=flat-square" alt="22 Evaluators" /></a>
  <a href="#task-adapters"><img src="https://img.shields.io/badge/adapters-5-74B9FF?style=flat-square" alt="5 Adapters" /></a>
  <a href="#cli-reference"><img src="https://img.shields.io/badge/CLI-cursor--plugin--evals-DFE6E9?style=flat-square" alt="CLI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Elastic--2.0-00E676?style=flat-square" alt="Elastic License 2.0" /></a>
</p>

<p align="center">
  End-to-end testing framework for Cursor plugins — validates structure, tests MCP tools,<br/>
  benchmarks performance, evaluates LLM agent quality, detects regressions, protects with guardrails,<br/>
  analyzes prompt sensitivity, and compares models.
</p>

---

## Quick Start

```bash
npm install

# One-command setup wizard — checks everything and guides you
npx cursor-plugin-evals setup

# Or step by step:

# Scaffold config from your plugin
npx cursor-plugin-evals init

# Run layers independently
npx cursor-plugin-evals run --layer static
npx cursor-plugin-evals run --layer unit
npx cursor-plugin-evals run --layer llm

# Skill evaluation with eval.yaml datasets
npx cursor-plugin-evals skill-eval --skill-dir ./skills/my-skill

# Compare models side-by-side
npx cursor-plugin-evals compare --model gpt-4o --model claude-sonnet-4-20250514

# Quality score with badge
npx cursor-plugin-evals score

# Auto-generate tests from tool schemas
npx cursor-plugin-evals gen-tests

# Detect regressions between runs
npx cursor-plugin-evals regression --baseline <run-id>

# Analyze prompt fragility
npx cursor-plugin-evals prompt-sensitivity --suite llm-tests

# Import production traces as test cases
npx cursor-plugin-evals trace-import --file trace.json

# Browse community eval suites
npx cursor-plugin-evals registry list
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                              CLI                                      │
│  run · init · setup · score · discover · doctor · dashboard · watch   │
│  skill-eval · collision-check · compare · ci-init · mock-gen          │
│  replay · history · env · security-lint · regression · gen-tests      │
│  trace-import · prompt-sensitivity · registry                         │
├──────────────────────────────────────────────────────────────────────┤
│                          Test Runner                                  │
│  Suite routing · Concurrency · Aggregation · Watch mode · CI gating   │
│  Multi-turn conversations · Guardrails · Regression detection         │
├────────┬────────┬──────────────┬────────────┬──────────┬─────────────┤
│ Static │ Unit   │ Integration  │ Perf.      │ LLM Eval │ Skill Eval  │
│ Layer  │ Layer  │ Layer        │ Layer      │ Layer    │ Layer        │
│        │        │              │            │          │              │
│ Mani-  │ Schema │ Tool exec    │ P50/P95/   │ Agent    │ eval.yaml   │
│ fest   │ Regis- │ Assertions   │ P99        │ loop     │ datasets     │
│ Front- │ trat-  │ Workflows    │ Through-   │ Tool     │ Per-example  │
│ matter │ ion    │ Error paths  │ put        │ select   │ overrides    │
│ Coher- │ Cond.  │ Auth flows   │ Memory     │ Multi-   │ Multi-       │
│ ence   │ regis. │ OAuth 2.0    │            │ turn     │ adapter      │
├────────┴────────┴──────────────┴────────────┴──────────┴─────────────┤
│                        Task Adapters                                  │
│  mcp · plain-llm · headless-coder · gemini-cli · claude-sdk           │
├──────────────────────────────────────────────────────────────────────┤
│  Plugin Discovery  │  MCP Client (stdio / HTTP / SSE / stream-HTTP)   │
│  Manifest parsing  │  Spawn · Connect · Execute · Auth flows          │
├──────────────────────────────────────────────────────────────────────┤
│ Evaluators (22)    │ CI Thresholds  │ Fixtures      │ Tracing         │
│ 13 CODE + 9 LLM   │ Score / Latency│ Record/Replay │ OTel spans      │
│ LLM-as-judge       │ Cost / Per-eval│ Mock-gen      │ ES export       │
├────────────────────┼────────────────┼───────────────┼─────────────────┤
│ Guardrails         │ Token Pricing  │ Skill Collis. │ Model A/B       │
│ Block/warn/log     │ Per-model cost │ TF-IDF sim.   │ Comparison      │
│ Pattern matching   │ 11+ models     │ Tool overlap  │ matrix          │
├────────────────────┼────────────────┼───────────────┼─────────────────┤
│ Regression Detect. │ Prompt Sens.   │ Test Auto-Gen │ Trace Import    │
│ Welch's t-test     │ Variant gen    │ Schema walker │ OTel → YAML     │
│ Fingerprints       │ Fragility flag │ Boundary/neg  │ Prod → tests    │
├────────────────────┼────────────────┼───────────────┼─────────────────┤
│ Quality Score      │ Failure Clust. │ Security Lint │ Recordings      │
│ A-F grading        │ Categorize +   │ 4 static      │ Store/replay    │
│ Confidence CIs     │ recommend fix  │ skill checks  │ full eval runs  │
├────────────────────┼────────────────┼───────────────┼─────────────────┤
│ LLM Cache          │ Eval Registry  │ OAuth 2.0     │ GitHub Action   │
│ Disk-persisted     │ Community      │ PKCE flow     │ CI/CD ready     │
│ TTL + hit/miss     │ share/import   │ Token cache   │ Composite       │
├────────────────────┴────────────────┴───────────────┴─────────────────┤
│ Reporting: Terminal · Markdown · JSON · HTML · JUnit XML               │
├──────────────────────────────────────────────────────────────────────┤
│                   Web Dashboard (Hono + SQLite)                        │
│  Run history · Suite drill-down · Quality trends · Real-time SSE      │
│  Model comparison · Regression trends · Live progress                  │
└──────────────────────────────────────────────────────────────────────┘
```

## Six Testing Layers

### Static Layer
Validates plugin structure without external dependencies — no MCP server, no cluster, no LLM needed.

- **Manifest**: plugin.json exists, name is valid kebab-case
- **Frontmatter**: Skills, rules, agents, commands have required metadata
- **Hooks schema**: hooks.json has valid events and existing scripts
- **MCP config**: .mcp.json servers have command or url
- **Cross-component coherence**: No duplicate names across components
- **Component references**: allowed-tools point to existing skills
- **Naming conventions**: All component names are kebab-case

### Unit Layer
Spawns the MCP server and validates tool registration without external services.

- **Registration**: Verify all expected tools are registered
- **Schema validation**: Validate inputSchema is well-formed JSON Schema
- **Conditional registration**: Test env-dependent tool availability
- **Response format**: Verify tool responses match MCP protocol

### Integration Layer
Executes MCP tool calls against a live or mock cluster.

- **Single tool calls** with assertions
- **Workflow chains** with variable binding between steps
- **Error handling** tests (invalid args, missing auth)
- **14 assertion operators**: eq, contains, exists, type, matches, and more

### Performance Layer
Benchmarks tool latency and throughput under configurable load.

- **Percentile tracking**: P50, P95, P99 latencies from recorded iterations
- **Warmup phase**: Configurable warmup iterations discarded from metrics
- **Concurrent load**: Parallel execution via `p-limit` with configurable concurrency
- **Memory tracking**: `process.memoryUsage()` delta before/after
- **Threshold gating**: Fail tests when P95 exceeds configured limits

### LLM Eval Layer
Pairs an LLM with MCP tools to evaluate agent quality.

- **Agent loop**: LLM selects tools, framework executes them, results fed back
- **Multi-model**: Test across OpenAI, Azure OpenAI, Anthropic, and any OpenAI-compatible endpoint
- **Azure OpenAI**: Native support via `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, and `AZURE_OPENAI_DEPLOYMENT`
- **Multi-turn conversations**: Scripted turn sequences with message history carry-over and per-turn assertions
- **Guardrails**: Real-time agent loop protection — block, warn, or log dangerous tool calls before execution
- **Difficulty tags**: simple, moderate, complex, adversarial
- **Distractor injection**: Random or targeted fake tools to test selection accuracy
- **Golden paths**: Path-efficiency scoring via LCS coverage
- **Confidence intervals**: 95% CI from repeated evaluations with optional CI-bound gating
- **Content filter resilience**: Azure content filter blocks are handled gracefully (treated as pass for security tests)
- **Mock mode**: Use recorded fixtures to avoid cluster costs

### Skill Eval Layer
Runs evaluation datasets against skills through pluggable adapters.

- **eval.yaml datasets**: Define examples with input, expected output, and metadata
- **Multi-adapter**: Run the same dataset through MCP, plain LLM, CLI agents, or SDKs
- **LLM-as-judge evaluators**: Correctness, groundedness, G-Eval, similarity, context-faithfulness
- **Per-example overrides**: Customize evaluators and thresholds per test case
- **Repetition support**: Run N repetitions per example for statistical confidence

```yaml
# skills/my-skill/eval.yaml
name: my-skill-eval
description: Evaluate skill quality
evaluators: [correctness, groundedness]
adapters: [mcp, plain-llm]
examples:
  - input: { prompt: "What is the cluster health?" }
    output: { responseContains: ["green", "cluster"] }
  - input: { prompt: "List all indices" }
    output: { responseContains: ["index"] }
    metadata:
      evaluators: [correctness, keywords]
```

## Task Adapters

Adapters decouple _what_ you test from _how_ the agent runs. Each adapter implements a common `TaskAdapter` interface:

| Adapter | What it does | When to use |
|---|---|---|
| `mcp` | Connects to plugin via MCP, runs full agent loop | Default — tests the complete plugin experience |
| `plain-llm` | Direct OpenAI-compatible API call (no tools) | Test raw LLM quality without MCP overhead |
| `headless-coder` | Uses headless coder SDK for code-gen agents | Test coding-oriented plugins |
| `gemini-cli` | Spawns Gemini CLI in JSONL mode | Test with Google's CLI agent |
| `claude-sdk` | Uses Anthropic Claude Code SDK | Test with Claude's agent runtime |

Configure per-suite in YAML:

```yaml
suites:
  - name: multi-adapter-eval
    layer: skill
    adapter: [mcp, plain-llm]
    skillDir: ./skills/my-skill
```

## Evaluators

### Deterministic (CODE)

| Evaluator | What it checks | Default threshold |
|---|---|---|
| `tool-selection` | Correct tools selected (F1 score) | 0.9 |
| `tool-args` | Argument values match expected | 0.7 |
| `tool-sequence` | Tools called in correct order (LCS) | 0.8 |
| `response-quality` | Response contains/excludes expected strings | 0.7 |
| `path-efficiency` | LCS coverage + efficiency vs golden path | 0.8 |
| `cluster-state` | HTTP assertions against cluster after execution | 1.0 |
| `mcp-protocol` | MCP calls are well-formed | 1.0 |
| `security` | No leaked credentials, SSRF, path traversal, excessive agency | 1.0 |
| `tool-poisoning` | Prompt injection pattern detection | 1.0 |
| `skill-trigger` | LLM selects correct skill from a set (F1) | 0.8 |
| `content-quality` | Component content scored on clarity/completeness | 0.6 |
| `keywords` | Expected keywords present in output | 0.7 |
| `rag` | Retrieval quality: Precision@K, Recall@K, F1@K | 0.7 |

### LLM-as-Judge (LLM)

These evaluators call an LLM judge (configurable via `JUDGE_MODEL` / `LITELLM_URL`) to score outputs:

| Evaluator | What it checks | Default threshold |
|---|---|---|
| `correctness` | Output correctness with label score floors (CORRECT/PARTIALLY_CORRECT/INCORRECT) | 0.7 |
| `groundedness` | Claims supported by tool call results (no hallucination) | 0.7 |
| `g-eval` | Multi-criteria scoring (relevance, coherence, configurable) | 0.6 |
| `similarity` | Semantic similarity between actual and expected output | 0.7 |
| `context-faithfulness` | RAG faithfulness — output only uses information from retrieved context | 0.7 |
| `conversation-coherence` | Multi-turn quality: turn relevance, consistency, goal progression | 0.7 |
| `criteria` | Configurable pass/fail criteria with weighted scoring | 0.7 |
| `plan-quality` | Reasoning chain quality: goal decomposition, step ordering, tool appropriateness | 0.7 |
| `task-completion` | Whether the user's actual goal was achieved (fully/partially/not at all) | 0.7 |

## LLM Provider Configuration

### OpenAI (default)

```bash
OPENAI_API_KEY=sk-...
JUDGE_MODEL=gpt-4o
```

### Azure OpenAI

```bash
AZURE_OPENAI_API_KEY=your-azure-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2025-01-01-preview  # optional, this is the default

# Optional: separate deployment for LLM judge evaluators
AZURE_JUDGE_DEPLOYMENT=gpt-4o-judge
```

### Anthropic

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### LiteLLM Proxy

```bash
LITELLM_PROXY_URL=http://localhost:4000
LITELLM_API_KEY=your-key  # or falls back to OPENAI_API_KEY
```

### OR-gated `require_env`

Use pipe (`|`) syntax in YAML to require at least one of several env vars:

```yaml
suites:
  - name: llm-tests
    layer: llm
    require_env: [OPENAI_API_KEY|AZURE_OPENAI_API_KEY]
```

## CI Thresholds

Structured CI threshold enforcement with percentile-based gating:

```yaml
ci:
  score:
    avg: 0.8
    p95: 0.7
  latency:
    avg: 5000
    p95: 10000
  cost:
    max: 5.00
  evaluators:
    correctness:
      avg: 0.8
      min: 0.5
    groundedness:
      avg: 0.7
```

```bash
# CI mode: enforce thresholds, exit non-zero on failure
cursor-plugin-evals run --ci
```

## Model Comparison

Run the same evaluation across multiple models and produce a comparison matrix:

```bash
cursor-plugin-evals compare \
  --model gpt-4o \
  --model claude-sonnet-4-20250514 \
  --model gemini-2.5-pro \
  --report terminal
```

Output includes per-test scores across models, aggregates (avg score, pass/fail counts, total latency, total cost), and a formatted comparison table.

## Skill Collision Detection

Analyze routing collisions between skills in your plugin — finds ambiguous descriptions and overlapping tool usage:

```bash
cursor-plugin-evals collision-check --dir .cursor-plugin/skills
```

Uses TF-IDF content similarity + Jaccard tool overlap to classify pairs as `ok`, `warn`, or `error` with actionable recommendations.

## Quality Score

Every run produces a composite quality score (0-100) with a letter grade (A-F) computed from five dimensions:

| Dimension | What it measures |
|---|---|
| **Structure** | Static checks pass rate (manifest, frontmatter, coherence) |
| **Correctness** | Unit + integration test pass rates |
| **Security** | Security evaluator scores across all layers |
| **Performance** | P95 latency within thresholds |
| **Agent Readiness** | LLM tool-selection, path-efficiency, workflow scores |

Weights are configurable via `scoring.weights` in `plugin-eval.yaml`. The score is rendered as an SVG badge for embedding in README files.

## Token & Cost Tracking

Built-in pricing catalog for 11+ models (GPT-4o, Claude Sonnet/Opus, Gemini Pro/Flash, and more). Cost is calculated per-test from token usage and surfaced in CI thresholds, comparison reports, and the dashboard.

```typescript
import { calculateCost } from 'cursor-plugin-evals';

const cost = calculateCost('gpt-4o', { input: 5000, output: 2000, cached: 1000 });
// => 0.0345 (USD)
```

## LLM Response Cache

Disk-persisted cache for LLM judge responses, reducing cost during iterative development:

```typescript
import { LlmCache } from 'cursor-plugin-evals';

const cache = new LlmCache({ ttl: '7d', dir: '.cursor-plugin-evals/cache' });
const cached = await cache.get('gpt-4o', systemPrompt, userPrompt);
if (!cached) {
  const response = await callLlm(...);
  await cache.set('gpt-4o', systemPrompt, userPrompt, response);
}
console.log(cache.getStats()); // { hits: 42, misses: 3 }
```

Configure via environment variables: `CPE_CACHE_ENABLED`, `CPE_CACHE_TTL`, `CPE_CACHE_DIR`.

## Failure Clustering

Automatically categorizes test failures and recommends fixes:

```typescript
import { clusterFailures } from 'cursor-plugin-evals';

const clusters = clusterFailures(failedTests);
// [{ category: 'wrong_tool_selection', count: 3, testNames: [...],
//    recommendedAction: 'Review SKILL.md tool descriptions...' }]
```

Categories: `wrong_tool_selection`, `wrong_arguments`, `wrong_ordering`, `hallucination`, `empty_response`, `content_quality`.

## Recording & Replay

Store full eval runs for later re-scoring without re-running LLMs:

```bash
# Replay recorded outputs with current evaluators
cursor-plugin-evals replay --skill alert-triage
cursor-plugin-evals replay --skill alert-triage --evaluators correctness groundedness --judge gpt-4o
```

```typescript
import { saveRecording, loadRecording, listRecordings } from 'cursor-plugin-evals';

await saveRecording('.cursor-plugin-evals/recordings', recordedRun);
const run = await loadRecording('.cursor-plugin-evals/recordings', 'alert-triage');
const all = await listRecordings('.cursor-plugin-evals/recordings');
```

## Security Lint

Static security checks on skill files — catches credentials, scope issues, and prompt injection:

```bash
cursor-plugin-evals security-lint --dir .cursor-plugin/skills
```

| Check | What it detects |
|---|---|
| `no-hardcoded-creds` | API keys, tokens, passwords in source files |
| `scope-declaration` | Skills that don't declare their tool/resource needs |
| `clean-example-data` | Real emails, non-RFC1918 IPs, production domains in examples |
| `tool-description-hygiene` | Prompt injection patterns in tool descriptions |

## Dataset Generator

Programmatically generate test examples from JS/TS modules:

```typescript
import { loadFromGenerator } from 'cursor-plugin-evals';

const examples = await loadFromGenerator('./generators/alert-triage.ts', { count: 50 });
```

Generator modules export a default async function returning an array of `{ prompt, input, expected, metadata }` objects.

## Multi-Turn Conversations

Test stateful multi-turn interactions where message history carries across turns:

```yaml
suites:
  - name: conversation-tests
    layer: llm
    tests:
      - name: multi-turn-cluster-check
        type: conversation
        turns:
          - prompt: "What's the cluster health?"
            expected:
              tools: [elasticsearch_api]
          - prompt: "Now show me the indices"
            expected:
              tools: [elasticsearch_api]
              responseContains: ["index"]
        evaluators: [tool-selection, conversation-coherence]
```

Each turn inherits the full message history from previous turns, and per-turn evaluators run independently.

## Guardrails

Protect agent loops from dangerous operations with pattern-based guardrails:

```yaml
guardrails:
  - name: block-delete-all
    pattern: "DELETE.*/_all|_delete_by_query"
    action: block
    message: "Blocked destructive DELETE operation"
  - name: warn-wildcards
    pattern: "\\*"
    action: warn
  - name: log-all-writes
    pattern: "PUT|POST"
    action: log
```

Actions: `block` prevents execution and returns an error to the LLM, `warn` logs a warning but continues, `log` records silently. Violations are tracked in test result metadata. Default guardrails for destructive operations (DELETE /_all, DROP DATABASE) are included.

## Regression Detection

Detect quality regressions between eval runs using statistical hypothesis testing:

```bash
# Run evaluation and compare against a saved baseline
npx cursor-plugin-evals regression --baseline <run-id>

# With custom significance level
npx cursor-plugin-evals regression --baseline <run-id> --alpha 0.01
```

Uses Welch's t-test to compare per-test score distributions between runs:
- **PASS**: No statistically significant regression detected
- **FAIL**: Statistically significant score drop (p < α and negative delta)
- **INCONCLUSIVE**: Insufficient samples (< 3) for statistical testing

Fingerprints (score vectors per test/evaluator) are automatically saved after each run in `.cursor-plugin-evals/fingerprints/`.

```typescript
import { buildFingerprint, detectRegressions } from 'cursor-plugin-evals';

const results = detectRegressions(baseline, current, 0.05);
results.forEach(r => console.log(`${r.key}: ${r.verdict} (p=${r.pValue.toFixed(4)})`));
```

## Test Auto-Generation

Generate test cases automatically from MCP tool JSON schemas:

```bash
# Generate tests for all tools
npx cursor-plugin-evals gen-tests

# Generate for a specific tool
npx cursor-plugin-evals gen-tests --tool elasticsearch_api

# Write to file
npx cursor-plugin-evals gen-tests --output generated-tests.yaml
```

Generates three categories per tool:
- **Valid**: Realistic values matching types, enums, patterns
- **Boundary**: Empty strings, 0, min/max values, empty arrays
- **Negative**: Missing required fields, wrong types, null for required fields

```typescript
import { generateTestsFromSchema, formatAsYaml } from 'cursor-plugin-evals';

const tests = generateTestsFromSchema('elasticsearch_api', toolSchema);
const yaml = formatAsYaml(tests, 'my-plugin');
```

## Prompt Sensitivity Analysis

Detect fragile prompts that produce inconsistent tool selections across rephrasings:

```bash
# Analyze a specific suite's prompts
npx cursor-plugin-evals prompt-sensitivity --suite llm-tools

# Custom variant count and threshold
npx cursor-plugin-evals prompt-sensitivity --suite llm-tools --variants 10 --threshold 0.15
```

The framework generates N LLM-powered rephrasings of each test prompt, runs all variants through the evaluation pipeline, and measures tool-selection score variance. Tests with variance above the threshold are flagged as "fragile".

```typescript
import { analyzeSensitivity } from 'cursor-plugin-evals';

const results = await analyzeSensitivity(config, 'llm-tools', 5, 0.2);
results.filter(r => r.isFragile).forEach(r => {
  console.log(`FRAGILE: ${r.testName} (variance: ${r.variance.toFixed(3)})`);
});
```

## Trace Import

Import production OTel traces and auto-generate test cases:

```bash
# Generate integration tests from a trace file
npx cursor-plugin-evals trace-import --file trace.json

# Also generate LLM tests from user prompts in traces
npx cursor-plugin-evals trace-import --file trace.json --llm

# Write to file
npx cursor-plugin-evals trace-import --file trace.json --output production-tests.yaml
```

Parses OpenTelemetry JSON traces, extracts tool_call spans (with `tool.*`, `gen_ai.*`, and `mcp.*` attribute prefixes), and generates YAML test definitions.

```typescript
import { parseOtelTrace, generateTestsFromTrace } from 'cursor-plugin-evals';

const trace = parseOtelTrace(JSON.parse(traceJson));
const yaml = generateTestsFromTrace(trace, { includeLlm: true });
```

## Eval Registry

Share and reuse community eval suites:

```bash
# Browse available suites
npx cursor-plugin-evals registry list

# Pull a suite into collections/
npx cursor-plugin-evals registry pull mcp-compliance

# Package your suite for sharing
npx cursor-plugin-evals registry push --suite ./my-suite.yaml
```

The registry index is a JSON file hosted on GitHub. Suites are YAML files pulled into `collections/` and run via `--collection <name>`.

```typescript
import { fetchRegistry, pullSuite } from 'cursor-plugin-evals';

const entries = await fetchRegistry();
const path = await pullSuite(entries[0]);
```

## OAuth 2.0 MCP Server Testing

Test OAuth-protected MCP servers with automated PKCE flow:

```yaml
plugin:
  auth:
    type: oauth2
    tokenUrl: https://auth.example.com/token
    authorizationUrl: https://auth.example.com/authorize
    clientId: my-client-id
    scopes: [read, write]
```

The framework handles the full OAuth 2.0 PKCE flow:
1. Generates code_verifier/code_challenge (SHA-256)
2. Opens browser to authorization URL
3. Starts temporary local HTTP server for the redirect callback
4. Exchanges auth code for tokens
5. Caches tokens in `.cursor-plugin-evals/tokens/` for reuse
6. Automatically refreshes expired tokens

Falls back to manual token input if the browser flow fails.

## GitHub Action

Drop-in CI/CD integration:

```yaml
# .github/workflows/eval.yml
name: Plugin Evaluation
on: [push, pull_request]

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/action
        with:
          config-path: plugin-eval.yaml
          layers: 'static unit integration'
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Outputs: `score`, `pass-rate`, `report-path`. Uploads JUnit XML and HTML reports as artifacts. See [docs/github-action.md](docs/github-action.md) for full documentation.

## Cursor Extension

A VS Code/Cursor extension scaffold is provided in `extension/` with:

- **CodeLens**: "Run Eval" and "Last: X%" annotations above test definitions in plugin-eval.yaml
- **Status Bar**: Quality score display (e.g., "Plugin Eval: A (96%)") with click-to-dashboard
- **Tree View**: Hierarchical suite > test > evaluator results with pass/fail icons
- **Commands**: "Plugin Eval: Run All", "Plugin Eval: Run Suite", "Plugin Eval: Show Dashboard"

See [docs/cursor-extension.md](docs/cursor-extension.md) for setup instructions.

## Real-Time Dashboard

The web dashboard (powered by Hono + SQLite) now includes:

- **SSE streaming**: Real-time progress during eval runs via `/api/events` endpoint
- **Model comparison**: Side-by-side view when runs include multiple models
- **Regression trends**: Quality score chart over time from stored run history
- **Live progress**: Test-by-test results appearing as they complete

```bash
npx cursor-plugin-evals dashboard --port 6280
```

## CLI Reference

```bash
# --- Core Commands ---

# Scaffold config from plugin discovery
cursor-plugin-evals init

# Run all suites
cursor-plugin-evals run

# Run specific layer
cursor-plugin-evals run --layer static
cursor-plugin-evals run --layer unit
cursor-plugin-evals run --layer integration --mock
cursor-plugin-evals run --layer performance
cursor-plugin-evals run --layer llm
cursor-plugin-evals run --layer skill

# Run specific suite
cursor-plugin-evals run --suite gateway-tools

# Watch mode (re-run on file changes)
cursor-plugin-evals run --watch

# CI mode (enforce thresholds, exit non-zero on failure)
cursor-plugin-evals run --ci

# Quality score with badge
cursor-plugin-evals score

# Reports (terminal, markdown, JSON, HTML, JUnit XML)
cursor-plugin-evals run --report markdown --output report.md
cursor-plugin-evals run --report html --output report.html
cursor-plugin-evals run --report junit-xml --output results.xml

# --- Skill & Model Commands ---

# Run skill evaluation with eval.yaml dataset
cursor-plugin-evals skill-eval --skill-dir ./skills/my-skill
cursor-plugin-evals skill-eval --skill-dir ./skills/my-skill --adapter mcp --adapter plain-llm

# Detect skill routing collisions
cursor-plugin-evals collision-check --dir .cursor-plugin/skills
cursor-plugin-evals collision-check --dir .cursor-plugin/skills --report json

# Compare models side-by-side
cursor-plugin-evals compare --model gpt-4o --model claude-sonnet-4-20250514

# --- Analysis Commands ---

# Detect regressions against a baseline run
cursor-plugin-evals regression --baseline <run-id>
cursor-plugin-evals regression --baseline <run-id> --alpha 0.01

# Auto-generate tests from tool schemas
cursor-plugin-evals gen-tests
cursor-plugin-evals gen-tests --tool elasticsearch_api --output generated.yaml

# Import production traces as test cases
cursor-plugin-evals trace-import --file trace.json
cursor-plugin-evals trace-import --file trace.json --llm --output prod-tests.yaml

# Analyze prompt sensitivity/fragility
cursor-plugin-evals prompt-sensitivity --suite llm-tools
cursor-plugin-evals prompt-sensitivity --suite llm-tools --variants 10 --threshold 0.15

# --- Registry Commands ---

# Browse community eval suites
cursor-plugin-evals registry list

# Pull a suite into collections/
cursor-plugin-evals registry pull mcp-compliance

# Package a suite for sharing
cursor-plugin-evals registry push --suite ./my-suite.yaml

# --- Infrastructure Commands ---

# Discover plugin components
cursor-plugin-evals discover --dir /path/to/plugin

# Record fixtures for mock mode
cursor-plugin-evals record --suite gateway-tools

# Generate mock MCP server from fixtures
cursor-plugin-evals mock-gen --fixture-dir ./fixtures --output ./mock-server.mjs

# Scaffold CI pipeline
cursor-plugin-evals ci-init --preset github

# List community test collections
cursor-plugin-evals collections

# Web dashboard (with real-time SSE streaming)
cursor-plugin-evals dashboard --port 6280

# Check infrastructure health
cursor-plugin-evals doctor

# Interactive setup wizard — checks and fixes everything
cursor-plugin-evals setup
cursor-plugin-evals setup --skip-docker    # skip Docker checks
cursor-plugin-evals setup --no-interactive # report only, no auto-fix

# --- Replay & History Commands ---

# Re-score recorded outputs against current evaluators (no LLM needed)
cursor-plugin-evals replay --skill alert-triage
cursor-plugin-evals replay --skill alert-triage --evaluators correctness groundedness

# List past evaluation runs from Elasticsearch
cursor-plugin-evals history
cursor-plugin-evals history --skill alert-triage --limit 10

# Show all supported environment variables
cursor-plugin-evals env

# Static security checks on skill files
cursor-plugin-evals security-lint --dir .cursor-plugin/skills
cursor-plugin-evals security-lint --skill my-skill
```

## Expect API (TypeScript)

Define suites programmatically alongside or instead of YAML:

```typescript
import { defineSuite, field } from 'cursor-plugin-evals';

export default defineSuite(
  { name: 'my-suite', layer: 'integration' },
  ({ integration, llm }) => {
    integration('health-check', {
      tool: 'elasticsearch_api',
      args: { method: 'GET', path: '/_cluster/health' },
      assert: [
        field('content.0.text').contains('cluster_name').compile(),
        field('isError').eq(false).compile(),
      ],
    });

    llm('tool-selection', {
      prompt: 'Check cluster health',
      expected: { tools: ['elasticsearch_api'] },
      evaluators: ['tool-selection', 'security'],
    });
  },
);
```

Save as `*.eval.ts` — the framework auto-discovers and merges with YAML suites.

## Configuration

See `plugin-eval.yaml` for a complete example. Key sections:

```yaml
plugin:
  name: my-cursor-plugin
  dir: "${PLUGIN_DIR}"
  entry: "node dist/index.js"
  transport: stdio           # stdio | http | sse | streamable-http
  auth:
    type: api-key
    key: "${API_KEY}"
  env:
    ES_URL: "http://localhost:9200"

scoring:
  weights:
    structure: 0.15
    correctness: 0.30
    security: 0.20
    performance: 0.15
    agentReadiness: 0.20

guardrails:
  - name: block-delete-all
    pattern: "DELETE.*/_all"
    action: block
  - name: warn-wildcards
    pattern: "\\*"
    action: warn

defaults:
  timeout: 30000
  judge_model: "gpt-4o"
  repetitions: 3
  thresholds:
    tool-selection: 0.9
    security: 1.0

ci:
  score: { avg: 0.8, p95: 0.7 }
  latency: { avg: 5000 }
  cost: { max: 5.00 }
  evaluators:
    correctness: { avg: 0.8 }

suites:
  - name: my-tests
    layer: integration
    tests: [...]

  - name: skill-eval
    layer: skill
    skillDir: ./skills/my-skill
    adapter: [mcp, plain-llm]
```

Environment variables use `${VAR_NAME}` interpolation syntax.

## Programmatic API

```typescript
import {
  // Core
  loadConfig, runEvaluation, McpPluginClient,
  createEvaluator, EVALUATOR_NAMES,

  // Adapters
  createAdapter,

  // Skill evaluation
  runSkillSuite, loadSkillDataset,

  // Analysis
  analyzeCollisions, scanSkills,
  buildComparisonFromRuns, formatComparisonTable,
  runSkillSecurityChecks, runAllSkillSecurityChecks,
  clusterFailures,

  // CI & pricing
  evaluateCi, convertFlatThresholds,
  calculateCost, getPricingCatalog,

  // Cache & recordings
  LlmCache,
  saveRecording, loadRecording, listRecordings,

  // Dataset generation
  loadFromGenerator,

  // Evaluator patterns
  matchesEvaluatorPattern, expandPatternsToEvaluators,

  // Multi-turn conversations
  runConversationTest,

  // Regression detection
  buildFingerprint, saveFingerprint, loadFingerprint,
  detectRegressions, welchTTest, formatRegressionReport,

  // Guardrails
  checkGuardrails, DEFAULT_GUARDRAILS,

  // Test auto-generation
  generateTestsFromSchema, formatAsYaml,

  // Trace import
  parseOtelTrace, generateTestsFromTrace,

  // Prompt sensitivity
  generateVariants, analyzeSensitivity, formatSensitivityReport,

  // Eval registry
  fetchRegistry, pullSuite, packageSuite,

  // Dashboard events
  EvalEventEmitter, globalEmitter,

  // OAuth 2.0
  runOAuthPkceFlow, refreshAccessToken,
  cacheTokens, loadCachedTokens, isTokenExpired,
} from 'cursor-plugin-evals';

// Run evaluation
const config = loadConfig('./plugin-eval.yaml');
const result = await runEvaluation(config, { layers: ['unit'] });
console.log(`Pass rate: ${result.overall.passRate}%`);
console.log(`Quality: ${result.qualityScore?.grade} (${result.qualityScore?.composite}/100)`);

// Check CI thresholds
const ciResult = evaluateCi(result.suites.flatMap(s => s.tests), config.ci ?? {});
console.log(ciResult.summary);

// Cluster failures for actionable triage
const clusters = clusterFailures(
  result.suites.flatMap(s => s.tests.filter(t => !t.pass).map(t => ({
    name: t.name,
    toolsCalled: t.toolCalls.map(tc => tc.tool),
    expected: undefined,
    evaluators: t.evaluatorResults.map(e => ({
      name: e.evaluator, score: e.score, label: e.label ?? null,
    })),
  }))),
);

// Cache LLM judge responses
const cache = new LlmCache({ ttl: '7d' });
```

## Fixture System

Record and replay MCP tool call/response pairs for offline testing:

```bash
# Record against live cluster
cursor-plugin-evals record

# Replay from fixtures
cursor-plugin-evals run --mock
```

Fixtures are stored as compressed JSONL (`.jsonl.gz`) with SHA-256 argument hashing for matching.

## Docker Infrastructure

Start the full test environment:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Services:
- **test-es** (port 9220): Ephemeral test Elasticsearch cluster
- **test-kibana** (port 5620): Test Kibana instance
- **obs-es** (port 9210): Persistent observability cluster
- **obs-kibana** (port 5601): Observability dashboards
- **edot-collector** (port 4318): OTEL trace collector

For mock-mode testing (no test cluster needed):

```bash
docker compose -f docker/docker-compose.lite.yml up -d
```

## Showcase

See [`showcase/elastic-cursor-plugin/`](showcase/elastic-cursor-plugin/) for a complete real-world evaluation suite covering all layers against the Elastic Cursor Plugin (11+ MCP tools).

## Cursor Integration

This framework includes Cursor skills, commands, and rules:

### Skills
- **run-plugin-evals**: Run eval suites with guided infrastructure checks
- **debug-eval-failure**: Systematic root cause analysis for failing tests
- **write-eval-suite**: Generate new test suites with coverage analysis
- **record-fixtures**: Record fixtures for mock-mode testing
- **eval-doctor**: Diagnose and fix infrastructure issues

### Commands
- `/eval:run` — Run evaluation suites
- `/eval:debug` — Debug failing tests
- `/eval:write` — Write new test suites
- `/eval:record` — Record fixtures
- `/eval:doctor` — Infrastructure diagnostics

### Rules
- `framework-conventions` — Code style and patterns
- `eval-suite-guidelines` — Best practices for writing test suites
- `mcp-client-patterns` — MCP client usage patterns

## Development

```bash
npm install
npm run typecheck    # TypeScript check
npm test             # Run framework tests (581 tests, 44 suites)
npm run build        # Build CLI binary
npm run lint:fix     # Fix linting issues
npm run format       # Format with prettier
```

## License

Elastic License 2.0 — see [LICENSE](LICENSE) for details.

You are free to use, modify, and distribute this software under the Elastic License 2.0, with two key limitations:

1. You may not provide the software to others as a managed service
2. You may not circumvent the license key functionality
