# Elastic Attack Emulation — Plugin Eval Showcase

End-to-end evaluation coverage for the [elastic/attack-emulation-cursor-plugin](https://github.com/elastic/attack-emulation-cursor-plugin).

## What's Tested

| Layer | Suites | Tests | Description |
|-------|--------|-------|-------------|
| **Static** | 1 | 7 | Manifest, skills, rules, MCP config, naming, cross-component coherence |
| **Unit** | 2 | 5 | All 15 tools registered, schema validation, category checks (infra/caldera/detection) |
| **Integration** | 4 | 18 | Infra status, Caldera search/list/versions, detection alerts/rules/coverage, error handling |
| **Performance** | 3 | 7 | p95 latency benchmarks for Caldera, infra, and detection tools |
| **LLM** | 7 | 39 | Tool selection (infra/caldera/detection), multi-tool workflows, security adversarial, multi-turn coherence |

**Total: 17 suites, 76 YAML tests** + **8 TypeScript programmatic suites** covering all 15 MCP tools across 3 packages.

### Security Coverage (within LLM layer)

10 adversarial tests covering OWASP MCP Top 10:
- Prompt injection / instruction override
- Credential leak attempts
- Destructive operations without confirmation
- SSRF via tool proxying
- Privilege escalation attacks
- Data exfiltration attempts
- Mass destructive campaigns
- Excessive agency
- Command injection via tool parameters

## Plugin Tools Under Test

### Infrastructure (`tools-infra`)
- `emulation_setup` — Start the emulation environment
- `emulation_status` — Check environment state
- `emulation_teardown` — Shut down the environment
- `deploy_agents` — Deploy Caldera Sandcat agents to VMs

### Caldera (`tools-caldera`)
- `search_attacks` — Search abilities by technique/tactic/platform
- `run_attack` — Execute a single MITRE technique
- `run_campaign` — Run a Caldera adversary profile
- `attack_status` — Check operation status
- `list_agents` — List connected agents
- `upgrade_attacks` — Refresh abilities from upstream
- `attack_versions` — Show ability versions

### Detection (`tools-detection`)
- `check_alerts` — Query Kibana alerts
- `validate_rule` — Run attack + check alerts
- `enable_rules` — Enable detection rules
- `rule_coverage` — Generate ATT&CK Navigator layer

## Prerequisites

```bash
# Clone this repo
git clone https://github.com/patrykkopycinski/cursor-plugin-evals
cd cursor-plugin-evals
npm ci

# Clone the plugin
git clone https://github.com/elastic/attack-emulation-cursor-plugin /path/to/plugin
cd /path/to/plugin && npm ci && npm run build
```

## Running Evals

### Static + Unit (no infrastructure needed)

```bash
export ATTACK_EMULATION_PLUGIN_DIR=/path/to/attack-emulation-cursor-plugin

npx cursor-plugin-evals run \
  --config showcase/attack-emulation-cursor-plugin/plugin-eval.yaml \
  --layer static --ci

npx cursor-plugin-evals run \
  --config showcase/attack-emulation-cursor-plugin/plugin-eval.yaml \
  --layer unit --ci
```

### Integration (requires Caldera)

```bash
# Start Caldera
cd /path/to/attack-emulation-cursor-plugin
docker compose -f docker/docker-compose.yml up -d

export CALDERA_URL=http://localhost:8888
export CALDERA_API_KEY=ADMIN123

npx cursor-plugin-evals run \
  --config showcase/attack-emulation-cursor-plugin/plugin-eval.yaml \
  --layer integration --ci
```

### Integration (requires Kibana + ES for detection tests)

```bash
# Start full stack
cd /path/to/attack-emulation-cursor-plugin
docker compose -f docker/docker-compose.yml --profile full up -d

export KIBANA_URL=http://localhost:5601
export KIBANA_USERNAME=elastic
export KIBANA_PASSWORD=changeme

npx cursor-plugin-evals run \
  --config showcase/attack-emulation-cursor-plugin/plugin-eval.yaml \
  --suite integration-detection --ci
```

### LLM Evals (requires API key)

```bash
export OPENAI_API_KEY=sk-...
# or AZURE_OPENAI_API_KEY=...

npx cursor-plugin-evals run \
  --config showcase/attack-emulation-cursor-plugin/plugin-eval.yaml \
  --layer llm --ci
```

### TypeScript Eval Suites

```bash
npx cursor-plugin-evals run \
  --ts showcase/attack-emulation-cursor-plugin/showcase.eval.ts --ci
```

### Full CI Run

```bash
npx cursor-plugin-evals run \
  --config showcase/attack-emulation-cursor-plugin/plugin-eval.yaml --ci
```

## CI

The GitHub Actions workflow (`.github/workflows/eval.yml`) runs in 4 parallel jobs:

1. **Static + Unit** — no infrastructure needed
2. **Integration + Performance (Caldera)** — Caldera service container
3. **Integration + Performance (Detection)** — ES + Kibana service containers
4. **LLM Evaluation** — API key required, runs on push/dispatch only

## Quality Gates

```yaml
ci:
  score:
    avg: 0.80
  evaluators:
    security:
      min: 1.0
  required_pass: [security, mcp-protocol]
  first_try_pass_rate: 0.75
```

## Known Plugin Issues

The `schema-validation-all` unit test flags 7 tool properties missing `.describe()` calls:
- `upgrade_attacks.source`
- `check_alerts.{technique, host, rule_name}`
- `enable_rules.{tactic, technique, keyword}`

These are upstream plugin bugs — fix them by adding `.describe()` to the Zod schema in `packages/mcp-server/src/index.ts`.
