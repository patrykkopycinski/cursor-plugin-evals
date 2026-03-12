# Elastic Cursor Plugin — Evaluation Showcase

Full evaluation suite for the [elastic-cursor-plugin](https://github.com/elastic/elastic-cursor-plugin), demonstrating every layer of cursor-plugin-evals against a real Cursor plugin with 11+ MCP tools.

## What This Tests

| Layer | Suite | What it validates |
|-------|-------|-------------------|
| Static | `static-analysis` | Manifest, frontmatter, hooks, MCP config, naming, coherence, references |
| Unit | `unit-tools` | All 11 tools registered with valid JSON Schemas |
| Integration | `integration-gateway` | elasticsearch_api, esql_query, kibana_api, cloud_api round-trips |
| Integration | `integration-security` | manage_detection_rules, triage_alerts, manage_cases |
| Integration | `integration-discovery` | discover_data, discover_o11y_data, discover_security_data, get_cluster_context |
| Performance | `performance-tools` | P95 latency benchmarks for high-frequency tools |
| LLM | `llm-tool-selection` | 12 prompts (simple → adversarial) with distractor injection |
| LLM | `llm-workflows` | Multi-step observability, security, diagnostics with golden paths |
| LLM | `llm-security` | Tool-poisoning, credential leak, SSRF adversarial tests |

## Prerequisites

- **Node.js** ≥ 20
- **Docker** (for integration/performance layers)
- **elastic-cursor-plugin** checked out locally
- **ES_API_KEY** for the test Elasticsearch cluster
- **OPENAI_API_KEY** or **ANTHROPIC_API_KEY** for LLM layers

## Setup

```bash
# Clone this repo and install deps
npm install

# Set required env vars
export ELASTIC_PLUGIN_DIR=/path/to/elastic-cursor-plugin
export ES_API_KEY=your-api-key

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

# All layers
npx cursor-plugin-evals run --config showcase/elastic-cursor-plugin/plugin-eval.yaml

# Mock mode (no cluster, uses recorded fixtures)
npx cursor-plugin-evals run --config showcase/elastic-cursor-plugin/plugin-eval.yaml --mock

# Quality score
npx cursor-plugin-evals score --config showcase/elastic-cursor-plugin/plugin-eval.yaml
```

## Use as a Template

1. Copy this directory to your project
2. Update `plugin-eval.yaml`:
   - Change `plugin.name` and `plugin.dir` to your plugin
   - Update `plugin.entry` to your MCP server entry point
   - Replace tool names in unit/integration/LLM suites with your tools
3. Adjust `scoring.weights` to match your plugin's priorities
4. Run `npx cursor-plugin-evals run --config plugin-eval.yaml --layer static` to verify setup

## Fixture Recording

> **Note:** Fixtures are not included in this repository — they require a live Elasticsearch cluster to record.
> To record fixtures for mock-mode testing:
>
> ```bash
> # Ensure Docker cluster is running
> docker compose -f docker/docker-compose.yml up -d
>
> # Record fixtures
> npx cursor-plugin-evals record --config showcase/elastic-cursor-plugin/plugin-eval.yaml
> ```
>
> Recorded fixtures are stored as `.jsonl.gz` files in `fixtures/` and enable fully offline test runs via `--mock`.

## CI Integration

See `.github/workflows/eval.yml` for a complete GitHub Actions pipeline that runs all layers with Docker infrastructure.
