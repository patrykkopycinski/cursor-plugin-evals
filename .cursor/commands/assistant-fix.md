---
description: >-
  Auto-fix ALL detected gaps, run evals to verify, and open PRs for changes.
argumentHint: "[gap-id or 'all']"
---

Use the **pr-bot** skill to autonomously:

1. Run a coverage audit to detect all gaps
2. **Fix every gap** — write tests, add evaluators, set thresholds
3. **Run evals** to verify all fixes work
4. **Fix any new failures** that appear from the generated tests
5. **Re-run until all CI thresholds pass**
6. Commit and open a PR with before/after quality scores

If "all" or no argument: fix every auto-fixable gap and converge to green.
If a gap-id: fix that specific gap, verify with evals, then PR.

The bot will NOT ask permission — it fixes, verifies, and PRs autonomously.
