---
description: >-
  Audit eval coverage, fix ALL gaps, run evals, and iterate until thresholds pass.
---

Use the **coverage-auditor** skill to autonomously:

1. Scan all components and existing coverage
2. Identify every gap using the **iterative deep scan** (up to 5 passes):
   - Eval coverage gaps (uncovered tools, missing layers, missing evaluators)
   - Content-level issues (script bugs, cross-file drift, broken references, security)
   - Classify findings by severity (CRITICAL/HIGH/MEDIUM/LOW/INFO)
   - Fix all HIGH+ issues, re-scan blast radius, repeat until clean
3. **Fix every gap immediately** — write missing tests, add evaluators, set thresholds, fix content
4. **Run evals** to validate fixes
5. **Fix any failures** that appear in the new tests
6. **Re-run until BOTH gates pass**: eval CI exits 0 AND content audit shows no HIGH/MEDIUM

The auditor will NOT ask which gaps to fix — it fixes ALL of them and iterates until green.
