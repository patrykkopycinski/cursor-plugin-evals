---
description: >-
  Analyze latest eval results, auto-fix actionable failures, and re-run until passing.
---

Use the **report-analyzer** skill to autonomously:

1. Load the latest eval run results
2. Cluster failures by root cause (wrong tool, wrong args, timeout, flaky, etc.)
3. **Auto-fix every actionable failure** — update YAML assertions, expectations, thresholds
4. **Re-run failing suites** to verify fixes
5. Calibrate CI thresholds if they're misconfigured
6. **Iterate until all suites pass and CI exits 0**

The analyzer will NOT just report findings — it will fix config issues and re-run until green.
