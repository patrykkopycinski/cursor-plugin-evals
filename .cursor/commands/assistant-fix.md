---
description: Auto-fix detected gaps — implement fixes and open PRs for both user repo issues and framework improvements.
argumentHint: "[gap-id or 'all']"
---

Use the **pr-bot** skill to fix detected gaps:

1. If a gap-id is provided, fix that specific gap
2. If "all" is provided, fix all auto-fixable gaps
3. If no argument, run the coverage auditor first, then fix all critical/high gaps

For each fix:
- Create a branch
- Implement the change (new tests, config updates, evaluator additions)
- Validate the fix (typecheck, test run, dry-run)
- Commit and open a PR

**User repo gaps** get PRs against the current repository.
**Framework gaps** get PRs against the cursor-plugin-evals repository.
