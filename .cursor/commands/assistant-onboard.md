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
5. **If content fixes are needed**, run the Content Audit Convergence Loop (up to 5 passes):
   - Scan changed files + blast radius for content-level issues
   - Classify by severity (CRITICAL/HIGH/MEDIUM/LOW/INFO), fix all HIGH+
   - Re-scan until no HIGH/MEDIUM remain
6. **Re-run until BOTH gates pass**: eval CI exits 0 AND content audit shows no HIGH/MEDIUM
7. Commit the green state

The assistant will iterate up to 5 times per layer and 5 content audit passes, fixing each issue as it goes. It will NOT ask permission — it will scan, generate, run, fix, and converge autonomously.
