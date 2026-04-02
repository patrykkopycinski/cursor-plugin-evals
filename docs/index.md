# cursor-plugin-evals

End-to-end testing framework for Cursor plugins — static analysis, MCP tool testing, LLM evaluation, trace-based evaluation, EDOT integration, red-teaming, guardrails, and production monitoring.

---

## Getting Started

- [Quick Start](./getting-started.md) — install, configure, and run your first eval
- [**Framework Assistant**](./framework-assistant.md) — autonomous AI agent that handles your entire eval lifecycle
- [External Evaluation](./external-eval.md) — evaluate any plugin without committing eval files to the target
- [Configuration Reference](./configuration.md) — complete `plugin-eval.yaml` reference

## Testing Layers

| Layer | Docs | What it validates |
|-------|------|-------------------|
| **Static** | [Guide](./layers/static.md) | Manifest, frontmatter, naming, cross-component coherence |
| **Unit** | [Guide](./layers/unit.md) | Tool registration, schemas, conditional registration |
| **Integration** | [Guide](./layers/integration.md) | Tool execution with assertions and workflows |
| **Performance** | [Guide](./layers/performance.md) | Latency percentiles, throughput, and memory |
| **LLM Eval** | [Guide](./layers/llm.md) | Agent loop — tool selection, correctness, security |
| **Skill Eval** | [Guide](./layers/skill.md) | Dataset-driven skill evaluation through adapters |
| **Conformance** | [Guide](./layers/conformance.md) | MCP protocol spec compliance (25 checks, tier scoring) |

## Core Concepts

- [Evaluators](./evaluators.md) — all 37 evaluators (CODE + LLM) with scoring details
- [Task Adapters](./adapters.md) — MCP, plain-llm, cursor-cli, headless-coder, gemini-cli, claude-sdk, otel-trace
- [Custom Evaluators](./custom-evaluators.md) — write evaluators in any language (TS, Python, Go, Shell)

## Features

- [Coverage Analysis](./coverage.md) — component x layer depth matrix with CLI, API, and badge
- [Test Auto-Generation](./gen-tests.md) — generate integration tests from MCP tool schemas
- [Smart Test Generation](./smart-gen.md) — LLM-powered generation with personas and edge cases
- [Multi-Turn Conversations](./conversations.md) — test multi-turn agent conversations
- [Conversation Simulation](./conversation-simulation.md) — simulate realistic user conversations
- [Prompt Sensitivity](./prompt-sensitivity.md) — detect fragile tests via prompt rephrasings
- [Prompt Optimization](./prompt-optimization.md) — iteratively improve prompts via hill climbing
- [Red-Teaming](./red-teaming.md) — adversarial security scanning across 10 attack categories
- [Regression Detection](./regression.md) — statistical hypothesis testing between runs
- [Agent Loop Guardrails](./guardrails.md) — pattern-based rules to block unsafe tool calls
- [Trace-Based Evaluation](./trace-eval.md) — evaluate OTel traces without re-execution
- [Custom Evaluators](./custom-evaluators.md) — write evaluators in any language (TS, Python, Go, Shell)
- [Agent Efficiency](./agent-efficiency.md) — detect loops, redundant calls, and step bloat
- [Conditional Evaluators](./conditional-evaluators.md) — skip evaluators based on context
- [Eval → Guardrails](./eval-guardrails.md) — promote security evaluators to runtime MCP interceptors
- [Cost Optimization](./cost-advisor.md) — find the cheapest model that meets your threshold
- [Dataset Management](./datasets.md) — versioned evaluation datasets with annotations
- [Multimodal Evaluation](./multimodal.md) — visual regression testing with screenshots

## Advanced

- [Web Dashboard](./dashboard.md) — 15-page UI with trends, traces, coverage, and re-run from browser
- [Visual Trace Viewer](./visual-trace-viewer.md) — timeline replay of conversations, tool calls, and evaluator results
- [Trace-Based Evaluation](./trace-eval.md) — evaluate OTel traces from files or Elasticsearch/EDOT without re-execution
- [Trace Ingestion](./trace-import.md) — import OTel traces and generate tests
- [Production Monitoring](./monitoring.md) — live scoring with real-time terminal UI and anomaly detection
- [Kibana Dashboard](./kibana-dashboard.md) — deploy eval results dashboard to Kibana (dashboard-as-code)
- [Harvest Command](./harvest.md) — convert failed production traces into regression tests
- [OTel Eval Events](./otel-eval-events.md) — emit eval results as standard OTel events
- [Notifications](./notifications.md) — Slack, GitHub PR comments, and webhooks
- [OAuth 2.0 Testing](./oauth.md) — test OAuth-protected MCP servers with PKCE

## CI/CD & Tooling

- [CI/CD Integration](./ci-cd.md) — GitHub Actions, GitLab CI, shell scripts
- [GitHub Action](./github-action.md) — ready-made action for plugin quality gates
- [Community Registry](./eval-registry.md) — browse, pull, and share evaluation suites
- [Cursor Extension](./cursor-extension.md) — in-editor CodeLens, status bar, and tree view

## Reference

- [API Reference](./api-reference.md) — all exports from `cursor-plugin-evals`
