# cursor-plugin-evals Documentation

End-to-end testing framework for Cursor plugins — static analysis, MCP tool testing, LLM evaluation, red-teaming, and production monitoring.

## Getting Started

- [Getting Started](./getting-started.md) — Install, configure, and run your first eval
- [**Framework Assistant**](./framework-assistant.md) — Autonomous AI agent that handles your entire eval lifecycle
- [Configuration Reference](./configuration.md) — Complete `plugin-eval.yaml` reference

## Core Concepts

- [Evaluators](./evaluators.md) — All 24 evaluators (CODE + LLM) with scoring details
- [Task Adapters](./adapters.md) — mcp, plain-llm, headless-coder, gemini-cli, claude-sdk, cursor-cli

## Testing Layers

- [Static Layer](./layers/static.md) — Manifest, frontmatter, naming, and coherence checks
- [Unit Layer](./layers/unit.md) — Registration, schema, and conditional registration checks
- [Integration Layer](./layers/integration.md) — Tool call testing with assertions and workflows
- [Performance Layer](./layers/performance.md) — Latency percentiles, concurrency, and memory
- [LLM Eval Layer](./layers/llm.md) — Agent loop evaluation with multi-model and mock support
- [Skill Eval Layer](./layers/skill.md) — Dataset-driven skill evaluation with adapters
- [Conformance Layer](./layers/conformance.md) — MCP protocol spec compliance (25 checks, tier scoring)

## Features

- [Test Auto-Generation](./gen-tests.md) — Generate integration tests from MCP tool schemas
- [Smart Test Generation](./smart-gen.md) — LLM-powered test generation with personas and edge cases
- [Multi-Turn Conversations](./conversations.md) — Test multi-turn agent conversations
- [Conversation Simulation](./conversation-simulation.md) — Simulate realistic user conversations
- [Prompt Sensitivity](./prompt-sensitivity.md) — Detect fragile tests via prompt rephrasings
- [Prompt Optimization](./prompt-optimization.md) — Iteratively improve prompts via hill climbing
- [Red-Teaming](./red-teaming.md) — Adversarial security scanning across 10 attack categories
- [Regression Detection](./regression.md) — Statistical hypothesis testing between runs
- [Agent Loop Guardrails](./guardrails.md) — Pattern-based rules to block unsafe tool calls
- [Cost Optimization](./cost-advisor.md) — Find the cheapest model that meets your threshold
- [Dataset Management](./datasets.md) — Versioned evaluation datasets with annotations
- [Multimodal Evaluation](./multimodal.md) — Visual regression testing with screenshots

## Advanced

- [Trace Ingestion](./trace-import.md) — Import OTel traces and generate tests
- [Production Monitoring](./monitoring.md) — Continuous trace scoring with anomaly detection
- [Visual Trace Viewer](./visual-trace-viewer.md) — Dashboard for browsing trace timelines
- [Notifications](./notifications.md) — Slack, GitHub PR comments, and webhooks
- [OAuth 2.0 Testing](./oauth.md) — Test OAuth-protected MCP servers with PKCE

## CI/CD & Tooling

- [CI/CD Integration](./ci-cd.md) — GitHub Actions, GitLab CI, shell scripts
- [GitHub Action](./github-action.md) — Ready-made GitHub Action for plugin quality gates
- [Community Registry](./eval-registry.md) — Browse, pull, and share evaluation suites
- [Cursor Extension](./cursor-extension.md) — In-editor CodeLens, status bar, and tree view

## API Reference

- [Programmatic API](./api-reference.md) — All exports from `cursor-plugin-evals`
