# Getting Started

Install cursor-plugin-evals and run your first evaluation in under five minutes.

## Prerequisites

- **Node.js 20+** — required
- **Docker** — optional, needed only if your plugin connects to services like Elasticsearch

Check your environment with the built-in doctor command:

```bash
npx cursor-plugin-evals doctor
```

## Installation

```bash
npm install cursor-plugin-evals
```

Or install globally:

```bash
npm install -g cursor-plugin-evals
```

## Setup Wizard

The interactive setup wizard checks prerequisites, discovers your plugin, and generates a config:

```bash
npx cursor-plugin-evals setup
```

This walks you through:
1. Environment checks (Node.js, Docker, API keys)
2. Plugin directory discovery
3. Transport configuration (stdio, HTTP, SSE, streamable-http)
4. Config file generation

## Your First Eval

### 1. Initialize a config

If you prefer to skip the wizard, generate a config directly:

```bash
npx cursor-plugin-evals init -d ./my-plugin -o plugin-eval.yaml
```

This discovers skills, rules, agents, commands, hooks, and MCP servers in your plugin directory and scaffolds a `plugin-eval.yaml` with suites for each layer.

### 2. Run the evaluation

```bash
npx cursor-plugin-evals run
```

By default this loads `./plugin-eval.yaml` and runs all configured suites. You'll see a terminal report with pass/fail per test, evaluator scores, and an overall quality grade.

### 3. Filter by layer

Run only static and unit checks (fast, no external dependencies):

```bash
npx cursor-plugin-evals run -l static unit
```

Run LLM evals (requires `OPENAI_API_KEY`):

```bash
OPENAI_API_KEY=sk-... npx cursor-plugin-evals run -l llm
```

### 4. Interpret results

The terminal report shows:

```
Suite: plugin-structure (static)
  ✅ valid-manifest
  ✅ skill-metadata
  ✅ naming-conventions

Suite: llm-e2e (llm)
  ✅ basic-prompt          tool-selection: 0.95  response-quality: 0.88
  ❌ edge-case-prompt      tool-selection: 0.60  response-quality: 0.45

Overall: 80% pass rate | Grade: B (82.3)
```

Each test shows its evaluator scores. A test passes when all evaluator scores meet their thresholds (configurable in `defaults.thresholds`).

### 5. Generate reports

```bash
# HTML dashboard
npx cursor-plugin-evals run --report html -o report.html

# JSON for CI pipelines
npx cursor-plugin-evals run --report json -o results.json

# JUnit XML for test aggregators
npx cursor-plugin-evals run --report junit-xml -o results.xml

# Markdown for PR comments
npx cursor-plugin-evals run --report markdown -o results.md
```

## Next Steps

- [Configuration Reference](./configuration.md) — tune thresholds, scoring weights, and guardrails
- [Static Layer](./layers/static.md) — validate plugin structure without running the server
- [Integration Layer](./layers/integration.md) — test individual tool calls with assertions
- [LLM Eval Layer](./layers/llm.md) — evaluate agent behavior with LLM judges
- [CI/CD Integration](./ci-cd.md) — enforce quality gates in your pipeline
