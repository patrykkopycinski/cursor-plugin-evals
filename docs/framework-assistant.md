# Framework Assistant

The Framework Assistant is an **autonomous AI agent** embedded in the Cursor plugin. It handles your entire evaluation lifecycle — from initial scan to green CI — without manual intervention.

## What It Does

| Phase | What happens | You do |
|-------|-------------|--------|
| **Deep Scan** | Discovers all MCP tools, skills, rules, agents, commands, and hooks | Nothing — it reads your entire plugin |
| **Infrastructure Setup** | Creates Docker Compose, test data, `.env.test`, CI workflows | Nothing — it scaffolds everything |
| **Generate Coverage** | Writes `plugin-eval.yaml` covering every component across all 7 layers | Nothing — it writes the YAML |
| **Run → Fix → Converge** | Executes tests, analyzes failures, fixes config, re-runs (up to 5x per layer) | Nothing — it iterates autonomously |
| **Calibrate Thresholds** | Tightens CI gates based on actual scores so quality never regresses | Nothing — it bumps thresholds |
| **Commit** | Stages and commits when CI is green | You review and push |

## How to Activate

The Framework Assistant activates automatically when you:

- Mention evals, testing, quality, or plugin evaluation in Cursor chat
- Open a plugin repository that has no `plugin-eval.yaml`
- Add new tools or skills to an existing plugin
- Say "evaluate my plugin", "help me set up evals", or "assistant"

Or trigger it explicitly:

```
evaluate my plugin
```

## The Convergence Loop

The assistant's core behavior is a **generate → run → fix → re-run** loop:

```
Phase 1: Scan → Discover all components
Phase 2: Generate → Write comprehensive plugin-eval.yaml
Phase 3: Run → Fix → Re-run (repeat until CI passes)
  ├── Static + Unit first (no external deps)
  ├── Integration next (requires services)
  ├── LLM layer (requires API keys)
  └── Full CI check
Phase 4: Calibrate → Tighten thresholds
Phase 5: Commit → Green state
```

The assistant doesn't stop after writing YAML. Its job is done when `npx cursor-plugin-evals run --ci` exits 0.

## Component Coverage

The assistant scans and generates tests for all 6 plugin component types:

### MCP Tools
- **Static**: Registration in manifest, schema validity
- **Unit**: Tool registration, schema validation, conditional registration
- **Integration**: Happy path execution with assertions, error handling, workflow chains
- **LLM**: Natural-language prompts that should trigger each tool, multi-tool scenarios
- **Performance**: P50/P95/P99 latency benchmarks

### Skills
- **Static**: Frontmatter validation (name, description, triggers), content quality
- **LLM**: Activation tests (should/should-not activate), cross-reference validation

### Rules
- **Static**: Frontmatter validation, content quality, glob validity

### Agents
- **Static**: Frontmatter validation (name, description, model)
- **LLM**: Domain behavior tests, tool usage verification

### Commands
- **Static**: Frontmatter validation, body quality
- **LLM**: Execution flow tests

### Hooks
- **Static**: Schema validation (events, handlers, matchers)

## Infrastructure Setup

For new plugins, the assistant creates:

| File | Purpose |
|------|---------|
| `docker/docker-compose.yml` | Backend services needed by the plugin |
| `scripts/seed-test-data.sh` | Domain-specific test data |
| `.env.test` | Test credentials |
| `scripts/run-evals.sh` | Orchestration script with flags |
| `.github/workflows/plugin-evals.yml` | CI pipeline with per-layer jobs |

## Threshold Calibration

After all tests pass, the assistant evaluates whether thresholds are properly calibrated:

| Headroom | Verdict | Action |
|----------|---------|--------|
| > 20% above threshold | Too lenient | Bump to `actual - 5%` |
| 10–20% above | Consider tightening | Bump if scores are stable |
| 5–10% above | Well calibrated | Leave as-is |
| < 5% above | Tight but OK | Monitor for flakiness |

Security thresholds are never lowered. Performance thresholds get a 20% buffer over actual measurements.

## Quality Bar

The assistant's generated eval file achieves:

- 100% coverage for every component type
- 5+ layers covered (static, unit, integration, llm, performance minimum)
- All CI thresholds passing
- Security evaluators on every LLM test
- Difficulty diversity (simple, moderate, complex, adversarial)
- 11+ evaluators used (46% utilization minimum)

## Proactive Behavior

The assistant doesn't wait to be asked. It activates when:

- A new tool or skill is added to the plugin (detected by file watchers)
- Coverage gaps are identified by the Coverage Auditor
- A plugin repo is opened without evaluation config
- Any eval run produces failures

## YAML Conventions

The assistant enforces strict YAML conventions:

- All field names are `snake_case` (the Zod schema validates before conversion)
- Assertion paths use dot notation: `content.0.text` not `content[0].text`
- Scoring weights are ≤ 1.0
- Env vars use `${VAR}` syntax (no bash-style defaults)

## See Also

- [Getting Started](./getting-started.md) — manual setup if you prefer
- [External Evaluation](./external-eval.md) — evaluate plugins without committing eval files to the target
- [Configuration Reference](./configuration.md) — what the assistant generates
- [CI/CD Integration](./ci-cd.md) — CI workflows the assistant creates
