# Elastic Cursor Plugin — Evaluation Showcase

Full evaluation suite for the [elastic-cursor-plugin](https://github.com/patrykkopycinski/elastic-cursor-plugin), demonstrating every layer of cursor-plugin-evals against a real Cursor plugin with 38 MCP tools.

## What This Tests

| Layer | Suite | What it validates |
|-------|-------|-------------------|
| Static | `static-analysis` | Manifest, frontmatter, hooks, MCP config, naming, coherence, references |
| Unit | `unit-always-registered` | 32 always-on tools registered with valid JSON Schemas |
| Unit | `unit-conditional-es` | elasticsearch_api, esql_query require ES_URL to register |
| Integration | `integration-gateway` | elasticsearch_api, esql_query, kibana_api, cloud_api round-trips |
| Integration | `integration-discovery` | discover_data, discover_o11y_data, discover_security_data, get_cluster_context |
| Integration | `integration-security` | manage_detection_rules, triage_alerts, manage_cases, siem_quickstart |
| Integration | `integration-smart-tools` | 10 smart tools (guides, dashboard, APM, log shipping, etc.) |
| Integration | `integration-agent-builder` | Agent Builder CRUD (tools, agents, MCP config) |
| Integration | `integration-knowledge-base` | Knowledge cache lifecycle (get → refresh → clear) |
| Integration | `integration-workflows` | Workflow list, save, run round-trip |
| Integration | `integration-mutation-roundtrip` | Detection rule create mutation |
| Integration | `integration-new-assertions` | New assertion operators: `one_of`, `starts_with`, `ends_with` |
| Performance | `performance-gateway` | P95 latency for ES API & ES\|QL |
| Performance | `performance-smart` | P95 latency for discovery & smart tools |
| LLM | `llm-tool-selection` | 12 prompts (simple → adversarial) with distractor injection |
| LLM | `llm-workflows` | Multi-step observability, security, diagnostics with golden paths |
| LLM | `llm-security` | 10 adversarial tests: tool-poisoning, credential leak, SSRF, path traversal, OWASP MCP Top 10 |
| LLM | `llm-multi-turn-coherence` | Multi-turn conversation coherence evaluation |
| Conformance | `conformance-protocol` | MCP protocol compliance (Tier 1/2/3, 25 checks) |
| Security | `security-audit` | 3-pass audit: static rules, capability graph, dependency chain |
| Chaos | `chaos-resilience` | Fault injection: timeouts, drops, corruption, disconnects |
| Schema Drift | `schema-drift-detection` | Auto-probe for declared-vs-actual schema mismatches |
| Fuzz | `fuzz-gateway-tools` | Property-based input space exploration |
| Compliance | `safe-mcp-compliance` | SAFE-MCP technique coverage (MITRE ATT&CK for MCP) |
| Multi-Server | `multi-server-attacks` | Cross-tool poisoning attack resistance |

### TypeScript Expect API Suites (`showcase.eval.ts`)

| Suite | What it demonstrates |
|-------|---------------------|
| `ts-integration-demo` | Basic `field()` assertions: `contains`, `eq` |
| `ts-new-assertion-ops` | New assertion operators: `oneOf`, `startsWith`, `endsWith` |
| `ts-run-assertions` | RunAssertion API: `maxIterations`, `callCount`, `successRate`, `noErrors`, `outputMatches`, `latencyUnder` |
| `ts-llm-demo` | Standard tool-selection + `conversation-coherence` evaluator |
| `ts-trajectory-demo` | Trajectory-based evaluation with golden path scoring |
| `ts-multi-judge-demo` | Multi-judge blind evaluation with Borda Count aggregation |

## Prerequisites

- **Node.js** ≥ 20
- **Docker** (for integration/performance layers)
- **elastic-cursor-plugin** checked out locally
- **OPENAI_API_KEY** or **ANTHROPIC_API_KEY** for LLM layers

## Setup

```bash
# Clone this repo and install deps
npm install

# Set required env vars
export ELASTIC_PLUGIN_DIR=/path/to/elastic-cursor-plugin

# Start test infrastructure
docker compose -f docker/docker-compose.yml up -d
```

## Running Each Layer

```bash
# Static only (no cluster, no API keys)
npx cursor-plugin-evals run --config showcase/elastic-cursor-plugin/plugin-eval.yaml --layer static

# Unit only (spawns MCP server, no cluster)
npx cursor-plugin-evals run --config showcase/elastic-cursor-plugin/plugin-eval.yaml --layer unit

# Integration (requires Docker cluster)
npx cursor-plugin-evals run --config showcase/elastic-cursor-plugin/plugin-eval.yaml --layer integration

# Performance benchmarks (requires Docker cluster)
npx cursor-plugin-evals run --config showcase/elastic-cursor-plugin/plugin-eval.yaml --layer performance

# LLM evals (requires API key + cluster or mock mode)
npx cursor-plugin-evals run --config showcase/elastic-cursor-plugin/plugin-eval.yaml --layer llm

# Conformance layer (MCP protocol compliance)
npx cursor-plugin-evals run --config showcase/elastic-cursor-plugin/plugin-eval.yaml --layer conformance

# All layers
npx cursor-plugin-evals run --config showcase/elastic-cursor-plugin/plugin-eval.yaml

# TypeScript Expect API suites
npx cursor-plugin-evals run --ts showcase/elastic-cursor-plugin/showcase.eval.ts
```

## Reporting Formats

Every command supports `--report <format>`:

```bash
# Terminal (default)
npx cursor-plugin-evals run --config ... --layer integration

# JUnit XML (CI-friendly)
npx cursor-plugin-evals run --config ... --layer integration --report junit-xml --output results.xml

# TAP (Test Anything Protocol)
npx cursor-plugin-evals run --config ... --layer integration --report tap --output results.tap

# Markdown
npx cursor-plugin-evals run --config ... --layer llm --report markdown --output report.md

# JSON
npx cursor-plugin-evals run --config ... --report json --output results.json

# HTML
npx cursor-plugin-evals run --config ... --report html --output report.html
```

## New Framework Capabilities Validated

### Conformance Layer (MCP Protocol Compliance)

Tests 25 protocol checks across 9 categories (initialization, tool/resource/prompt listing, execution, error handling, capability negotiation) and assigns a Tier 1/2/3 score.

### 3-Pass Security Audit

1. **Static rules** — 20 OWASP MCP Top 10-aligned rules
2. **Capability graph** — infers tool capabilities and detects dangerous combinations (e.g., data read + network write = exfiltration risk)
3. **Dependency chain** — supply chain risks, typosquatting, lifecycle script audits

```bash
npx cursor-plugin-evals audit --config showcase/elastic-cursor-plugin/plugin-eval.yaml
```

### Cross-Platform Compatibility

Checks plugin compatibility across Cursor, Claude Code, ChatGPT, and generic MCP clients:

```bash
npx cursor-plugin-evals compat --dir $ELASTIC_PLUGIN_DIR
```

### Multi-Judge Blind Evaluation

Multiple LLM judges evaluate independently with configurable aggregation (Borda Count, majority vote, weighted average, median). See `ts-multi-judge-demo` in `showcase.eval.ts`.

### RunAssertion API (Agent Loop Checks)

Assert on agent execution behavior, not just tool output:

```typescript
run()
  .maxIterations(4)
  .callCount('elasticsearch_api', 1, 3)
  .noErrors()
  .latencyUnder(30_000)
  .toChecks()
```

### Hybrid Proxy Mock Mode

Three fixture modes for offline testing:
- `mock` — fixture-only (fully offline)
- `passthrough` — live-only (no fixtures)
- `hybrid` — fixture with live fallback and response comparison

```bash
npx cursor-plugin-evals run --config ... --mock          # fixture-only
npx cursor-plugin-evals run --config ... --mock hybrid    # hybrid mode
```

### Public Leaderboard

```bash
npx cursor-plugin-evals leaderboard --format markdown --output leaderboard.md
npx cursor-plugin-evals leaderboard --format html --output leaderboard.html
```

### Chaos Engineering / Fault Injection

Tests plugin resilience under degraded conditions — timeouts, dropped connections, corrupted messages, disconnects, slow drains, reordering, and duplicate responses. Configurable intensity (low/medium/high) with deterministic seeded PRNG.

```bash
npx cursor-plugin-evals chaos --config showcase/elastic-cursor-plugin/plugin-eval.yaml --intensity medium
```

### Schema Drift Detection

Auto-generates probe inputs from tool schemas and detects mismatches between declared schema and actual behavior (hidden required fields, accepted invalid types, enum mismatches, missing validation).

```bash
npx cursor-plugin-evals schema-drift --config showcase/elastic-cursor-plugin/plugin-eval.yaml
```

### Property-Based / Fuzz Testing

Systematically explores the input space of each tool — boundary values, type coercion, null injection, overflow, unicode edge cases, deeply nested objects, and combinatorial field subsets.

```bash
npx cursor-plugin-evals fuzz --config showcase/elastic-cursor-plugin/plugin-eval.yaml
```

### SAFE-MCP Compliance Mapping

Maps all security rules and red-team findings to the SAFE-MCP framework (Linux Foundation's MITRE ATT&CK adaptation for MCP) with per-tactic coverage percentages.

```bash
npx cursor-plugin-evals safe-mcp --config showcase/elastic-cursor-plugin/plugin-eval.yaml
```

### Multi-Server Cross-Tool Attack Testing

Tests resistance to tool poisoning in multi-server environments — description injection, response hijacking, context manipulation, tool shadowing, and data exfiltration relay.

### Trajectory-Based Evaluation

Scores the full reasoning path of agent interactions using LCS-based path similarity, step efficiency, backtrack/redundancy penalties, and error recovery bonuses. See `ts-trajectory-demo` in `showcase.eval.ts`.

### SVG Badge Generation

Generate embeddable SVG badges for GitHub READMEs:

```bash
npx cursor-plugin-evals badge --type score --output badge.svg
npx cursor-plugin-evals badge --type pass-rate --output pass-rate.svg
npx cursor-plugin-evals badge --type conformance --output conformance.svg
npx cursor-plugin-evals badge --type security --output security.svg
npx cursor-plugin-evals badge --type resilience --output resilience.svg
```

## Fixture Recording

> **Note:** Fixtures are not included in this repository — they require a live Elasticsearch cluster to record.

```bash
# Ensure Docker cluster is running
docker compose -f docker/docker-compose.yml up -d

# Record fixtures
npx cursor-plugin-evals record --config showcase/elastic-cursor-plugin/plugin-eval.yaml
```

Recorded fixtures are stored as `.jsonl.gz` files in `fixtures/` and enable fully offline test runs via `--mock`.

## CI Integration

See `.github/workflows/eval.yml` for a complete GitHub Actions pipeline that runs:

- **Static + Unit + Conformance** — no infra needed
- **Cross-platform compatibility** and **3-pass security audit**
- **Integration + Performance** — with Docker Elasticsearch & Kibana services
- **LLM evals + TypeScript suites** — on push/dispatch only
- **Leaderboard generation** — aggregated model rankings
- Multiple report formats: JUnit XML, TAP, Markdown, JSON

## Use as a Template

1. Copy this directory to your project
2. Update `plugin-eval.yaml`:
   - Change `plugin.name` and `plugin.dir` to your plugin
   - Update `plugin.entry` to your MCP server entry point
   - Replace tool names in unit/integration/LLM suites with your tools
3. Adjust `scoring.weights` to match your plugin's priorities
4. Run `npx cursor-plugin-evals run --config plugin-eval.yaml --layer static` to verify setup
