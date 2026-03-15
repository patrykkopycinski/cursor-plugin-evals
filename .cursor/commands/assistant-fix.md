---
description: >-
  Auto-fix ALL detected gaps, run evals to verify, and open PRs for changes.
argumentHint: "[gap-id or 'all']"
---

Use the **pr-bot** skill to autonomously:

1. Run a coverage audit to detect all gaps (eval coverage + content-level issues)
2. **Fix every gap** — write tests, add evaluators, set thresholds, fix content bugs
3. **If content fixes are involved**, run the Content Audit Convergence Loop:
   - Up to 5 passes of scan → classify → fix → re-scan blast radius
   - Severity-gated: iterate until no HIGH/MEDIUM findings remain
4. **Run evals** to verify all fixes work
5. **Fix any new failures** that appear from the generated tests
6. **Re-run until BOTH gates pass**: eval CI exits 0 AND content audit clean
7. Commit and open a PR with before/after quality scores and per-pass audit evidence

If "all" or no argument: fix every auto-fixable gap and converge to green.
If a gap-id: fix that specific gap, verify with evals, then PR.

The bot will NOT ask permission — it fixes, verifies, and PRs autonomously.
