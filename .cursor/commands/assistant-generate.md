---
description: >-
  Generate tests for ALL coverage gaps, run them, fix failures, converge to green.
argumentHint: "[strategy] [tool-name]"
---

Use the **eval-generator** skill to autonomously:

1. Scan all components and compare against existing coverage
2. **Generate ALL missing tests** in one pass (integration, LLM, security, performance)
3. **Run the generated tests** to validate they work
4. **Fix any failures** — update assertions, prompts, expectations
5. **Re-run until all new tests pass and CI thresholds are met**

If a tool name is provided, generate comprehensive tests for that specific tool.
If no arguments, fill ALL coverage gaps and iterate until green.

The generator will NOT ask "want more tests?" — it generates everything and converges.
