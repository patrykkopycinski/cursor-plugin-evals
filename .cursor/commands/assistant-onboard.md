---
description: >-
  Onboard to cursor-plugin-evals — scan the repo, generate comprehensive eval coverage,
  run tests, fix failures, and iterate until all CI thresholds pass.
---

Use the **framework-assistant** skill to autonomously:

1. Scan this repository for ALL plugin components (MCP tools, skills, rules, agents, commands)
2. Generate a comprehensive `plugin-eval.yaml` covering every component across all layers (static, unit, integration, LLM, security, performance)
3. **Run the evals** (`npx cursor-plugin-evals run --verbose`)
4. **Auto-fix any failures** — update assertions, expectations, thresholds, timeouts
5. **Re-run until all CI thresholds pass** (`npx cursor-plugin-evals run --ci` exits 0)
6. Commit the green state

The assistant will iterate up to 5 times per layer, fixing each failure as it goes. It will NOT ask permission — it will scan, generate, run, fix, and converge autonomously.
