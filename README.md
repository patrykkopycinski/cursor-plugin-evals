<p align="center">
  <img src="assets/banner.svg" alt="cursor-plugin-evals" width="100%" />
</p>

<p align="center">
  <a href="https://patrykkopycinski.github.io/cursor-plugin-evals/#/getting-started"><img src="https://img.shields.io/badge/layers-12-6C5CE7?style=flat-square" alt="12 Layers" /></a>
  <a href="https://patrykkopycinski.github.io/cursor-plugin-evals/#/evaluators"><img src="https://img.shields.io/badge/evaluators-27-A29BFE?style=flat-square" alt="27 Evaluators" /></a>
  <a href="https://patrykkopycinski.github.io/cursor-plugin-evals/#/adapters"><img src="https://img.shields.io/badge/adapters-6-74B9FF?style=flat-square" alt="6 Adapters" /></a>
  <a href="https://patrykkopycinski.github.io/cursor-plugin-evals/#/red-teaming"><img src="https://img.shields.io/badge/security--rules-20-E74C3C?style=flat-square" alt="20 Security Rules" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Elastic--2.0-00E676?style=flat-square" alt="Elastic License 2.0" /></a>
</p>

<p align="center">
  The most comprehensive testing framework for Cursor &amp; MCP plugins.<br/>
  Ships with an <strong>autonomous Framework Assistant</strong> that scans, generates, runs, fixes, and calibrates — hands-free.<br/>
  <a href="https://patrykkopycinski.github.io/cursor-plugin-evals">Documentation</a> · <a href="site/index.html">Landing Page</a> · <a href="showcase/elastic-cursor-plugin/">Showcase</a>
</p>

---

## Framework Assistant

The killer feature: an **autonomous AI agent** that does the entire eval lifecycle for you. Point it at your plugin and it will:

1. **Deep scan** your plugin — discovers all MCP tools, skills, rules, agents, commands, and hooks
2. **Set up infrastructure** — creates Docker Compose, test data seeds, `.env.test`, CI workflows
3. **Generate complete coverage** — writes a comprehensive `plugin-eval.yaml` covering every component across all layers
4. **Run the tests** — executes all suites and analyzes failures
5. **Fix what fails** — iterates up to 5 times per layer, fixing YAML, assertions, and prompts
6. **Calibrate thresholds** — tightens CI gates based on actual scores so quality never regresses

```bash
# Just say "evaluate my plugin" in Cursor chat — the assistant takes it from there
```

No manual YAML writing. No guessing at thresholds. No hunting for missing coverage. The Framework Assistant handles it end-to-end, and doesn't stop until `npx cursor-plugin-evals run --ci` exits 0.

---

## Quick Start

```bash
npm install

# One-command setup wizard
npx cursor-plugin-evals setup

# Or step by step:
npx cursor-plugin-evals init          # Scaffold config from your plugin
npx cursor-plugin-evals run           # Run all layers
npx cursor-plugin-evals run --ci      # Enforce CI quality gates
npx cursor-plugin-evals score         # Quality score with badge
```

## External Evaluation (No Commit Mode)

Evaluate any plugin without committing eval files to the target repo. All configs, results, and infrastructure stay local — only content improvements are applied to the target.

```bash
# 1. Create a workspace targeting an external repo
npx cursor-plugin-evals external-init --external ~/Projects/some-plugin --scope skills/security

# 2. Run evals (config lives in workspaces/, not the target)
npx cursor-plugin-evals run -c workspaces/some-plugin-skills-security/plugin-eval.yaml

# 3. Apply only skill/rule improvements to the target
npx cursor-plugin-evals apply-fixes --workspace workspaces/some-plugin-skills-security

# 4. Generate a PR-ready findings report
npx cursor-plugin-evals pr-findings --workspace workspaces/some-plugin-skills-security -o FINDINGS.md
```

See [External Evaluation docs](docs/external-eval.md) for the full workflow.

## What It Tests

Every Cursor plugin component is covered — not just MCP tools:

| Component | Layers | What's tested |
|-----------|--------|---------------|
| **MCP Tools** | static, unit, integration, llm, performance | Registration, schema, execution, LLM selection, latency |
| **Skills** | static, llm | Frontmatter, activation triggers, cross-references |
| **Rules** | static | Frontmatter, content quality, glob validity |
| **Agents** | static, llm | Frontmatter, domain behavior |
| **Commands** | static, llm | Frontmatter, execution flow |
| **Hooks** | static | Schema validation |

## Testing Layers

| Layer | What it validates | External deps |
|-------|-------------------|---------------|
| **Static** | Manifest, frontmatter, naming, cross-component coherence | None |
| **Unit** | Tool registration, schemas, conditional registration | MCP server only |
| **Integration** | Tool execution with assertions and workflows | Live/mock cluster |
| **Performance** | P50/P95/P99 latency, throughput, memory | Live cluster |
| **LLM Eval** | Agent loop — tool selection, correctness, security | LLM API |
| **Skill Eval** | Dataset-driven evaluation through adapters | Adapter-dependent |
| **Conformance** | MCP protocol spec compliance (25 checks) | MCP server only |

## Key Features

- **27 evaluators** — 15 deterministic + 9 LLM-as-judge + multi-judge blind panel
- **Evaluator skip/not-applicable** — auto-skips inapplicable evaluators per adapter
- **Per-adapter evaluator config** — add/remove/override evaluators at the suite level
- **Adapter-aware context** — evaluators know which adapter is running and its capabilities
- **6 task adapters** — MCP, plain-llm, cursor-cli, headless-coder, gemini-cli, claude-sdk
- **20 OWASP-aligned security rules** with 3-pass audit and red-teaming
- **Security domain awareness** — exclude locations to prevent false positives
- **SAFE-MCP compliance** with 26 attack technique coverage
- **Auto-test generation** — schema-based and LLM-powered smart generation
- **Regression detection** — Welch's t-test between runs with fingerprinting
- **Multi-model comparison** — fair benchmarking with Borda count medals
- **Prompt optimization** — hill-climbing to improve eval scores
- **Production monitoring** — OTel trace scoring with anomaly detection
- **154 community tests** for 15 popular MCP servers
- **13-page web dashboard** with dark mode, live SSE, and interactive charts
- **Coverage analysis** — static analysis of component x layer coverage with CLI, API, dashboard, and badge
- **Cost optimization** — find the cheapest model per test that meets quality thresholds
- **Threshold auto-calibration** — tighten CI gates when scores exceed thresholds
- **Typed evaluator configs** — type-safe configuration for token-usage, workflow, security, groundedness
- **Configurable adapter retry** — exponential backoff with pattern-based retry for CLI race conditions
- **Token input estimation** — estimates input tokens for adapters that don't report them

## Model Defaults

| Context | Default |
|---------|---------|
| Judge model | `gpt-5.4` |
| Multi-judge panel | `gpt-5.4` + `claude-opus-4-6` + `gemini-3.1-pro` |
| Task adapters | `gpt-5.4` |
| Red-team / smart gen | `gpt-5.4-mini` |

Override via `JUDGE_MODEL` env var, `judge_model` in YAML, or `--model` CLI flag.

## CI Integration

```yaml
ci:
  score: { avg: 0.85, min: 0.5 }
  evaluators: { security: { min: 1.0 }, tool-selection: { avg: 0.9 } }
  required_pass: [security, tool-poisoning, mcp-protocol]
  first_try_pass_rate: 0.80

# Per-adapter evaluator overrides — different adapters, different evaluators:
suites:
  - name: cli-behavior
    adapter: cursor-cli
    evaluators:
      add: [groundedness, workflow]  # Only cursor-cli supports tool calls
  - name: llm-behavior
    adapter: plain-llm
    evaluators:
      remove: [groundedness, workflow]  # Skip tool-dependent evaluators
```

```bash
npx cursor-plugin-evals run --ci   # Exit non-zero if any gate fails
```

GitHub Action, GitLab CI, and shell script examples in [docs/ci-cd.md](docs/ci-cd.md).

## Docker Infrastructure

```bash
docker compose -f docker/docker-compose.yml up -d    # Full test environment
docker compose -f docker/docker-compose.lite.yml up -d  # Lightweight (mock mode)
```

## Web Dashboard

A 13-page web UI for visualizing evaluation results, trends, coverage, security, and model comparisons.

```bash
npx cursor-plugin-evals dashboard          # Start on default port
npx cursor-plugin-evals dashboard --port 8080  # Custom port
```

<p align="center">
  <img src="docs/screenshots/dashboard-overview.png" alt="Dashboard overview showing total runs, pass rate, grade, and trend chart" width="90%" />
</p>

<p align="center"><em>Dashboard overview — at-a-glance plugin health with stat cards and pass rate trend.</em></p>

Drill into any run to see suite-level breakdown with individual test results:

<p align="center">
  <img src="docs/screenshots/dashboard-run-detail.png" alt="Run detail view with suite-level breakdown and test results" width="90%" />
</p>

<p align="center"><em>Run detail — suite pass rates, test-level status, and timing data.</em></p>

Track quality over time with pass rate and quality score trend charts:

<p align="center">
  <img src="docs/screenshots/dashboard-trends.png" alt="Trend charts showing pass rate and quality score over time" width="90%" />
</p>

<p align="center"><em>Trends — pass rate and quality score trajectories across evaluation history.</em></p>

Security findings from the latest run:

<p align="center">
  <img src="docs/screenshots/dashboard-security.png" alt="Security findings with prompt injection and privilege escalation test results" width="90%" />
</p>

<p align="center"><em>Security — prompt injection, privilege escalation, and OWASP-aligned test results.</em></p>

See [Dashboard docs](docs/dashboard.md) for the full page reference.

## Coverage Analysis

Analyze which test layers cover each plugin component — without running any evals.

```bash
npx cursor-plugin-evals coverage                         # Terminal matrix
npx cursor-plugin-evals coverage --report markdown        # Markdown table
npx cursor-plugin-evals coverage --report badge -o badge.svg  # SVG badge
```

<p align="center">
  <img src="docs/screenshots/dashboard-coverage.png" alt="Coverage matrix showing component × layer test coverage" width="90%" />
</p>

<p align="center"><em>Coverage matrix — depth coverage across tools, skills, rules, agents, and commands.</em></p>

Two metrics: **Component Coverage** (% with any test) and **Depth Coverage** (% of applicable layer slots filled). See [Coverage docs](docs/coverage.md) for details.

## Documentation

Full documentation at **[patrykkopycinski.github.io/cursor-plugin-evals](https://patrykkopycinski.github.io/cursor-plugin-evals)**:

- [Getting Started](docs/getting-started.md)
- [Configuration Reference](docs/configuration.md)
- [Testing Layers](docs/layers/static.md) (static, unit, integration, performance, LLM, skill, conformance)
- [Evaluators](docs/evaluators.md) (27 evaluators with scoring details)
- [Task Adapters](docs/adapters.md) (MCP, cursor-cli, claude-sdk, etc.)
- [Coverage Analysis](docs/coverage.md)
- [Web Dashboard](docs/dashboard.md)
- [Security & Red-Teaming](docs/red-teaming.md)
- [CI/CD Integration](docs/ci-cd.md)
- [API Reference](docs/api-reference.md)

## Cursor Plugin Integration

This framework ships as a Cursor plugin with an **autonomous assistant** and supporting skills, commands, and rules:

### Framework Assistant (the star)

The Framework Assistant is an always-on AI agent embedded in the Cursor plugin. It activates when you mention evals, testing, quality, or plugin evaluation — or when it detects a plugin repo without coverage. It autonomously:

- Scans every component type (MCP tools, skills, rules, agents, commands, hooks)
- Generates `plugin-eval.yaml` with 100% coverage across all layers
- Sets up Docker, test data, `.env.test`, and CI workflows from scratch
- Runs → fixes → re-runs in a convergence loop until CI passes
- Calibrates thresholds so they track actual quality (no stale gates)

### Supporting tools

| Type | Name | What it does |
|------|------|-------------|
| Skill | Coverage Auditor | Finds and fixes all coverage gaps |
| Skill | Debug Eval Failure | Root cause analysis for failing tests |
| Skill | Eval Generator | Generates tests for specific component types |
| Command | `/eval:run` | Run evaluation suites |
| Command | `/eval:debug` | Debug failing tests |
| Command | `/eval:write` | Write new test suites |
| Rule | proactive-coverage | Auto-generate tests when tools/skills are added |
| Rule | post-run-analysis | Auto-diagnose and fix failures after every run |
| Rule | new-component-detection | Triggers test generation for newly added components |

## Development

```bash
npm install
npm run typecheck    # TypeScript check
npm test             # Run framework tests (1163 tests)
npm run build        # Build CLI binary
npm run lint:fix     # Fix linting issues
```

## License

[Elastic License 2.0](LICENSE) — free to use, modify, and distribute. See license for managed service and license key restrictions.
