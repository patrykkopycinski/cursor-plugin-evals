---
description: >-
  Audit eval coverage, fix ALL gaps, run evals, and iterate until thresholds pass.
---

Use the **coverage-auditor** skill to autonomously:

1. Scan all components and existing coverage
2. Identify every gap (uncovered tools, missing layers, missing evaluators, etc.)
3. **Fix every gap immediately** — write missing tests, add evaluators, set thresholds
4. **Run evals** to validate fixes
5. **Fix any failures** that appear in the new tests
6. **Re-run until all CI thresholds pass**

The auditor will NOT ask which gaps to fix — it fixes ALL of them and iterates until green.
