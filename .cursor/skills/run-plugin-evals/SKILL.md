---
name: run-plugin-evals
description: Run plugin evaluation suites, automatically fix failures, and re-run until all CI thresholds pass. Use when the user wants to test a plugin, run evals, check quality, validate tools, or says "run tests", "run evals", "test the plugin", "check quality".
license: MIT
metadata:
  author: cursor-plugin-evals
  version: "2.0"
---

Run evaluation suites against a Cursor plugin's MCP server. **Automatically fix failures and re-run until all CI thresholds pass.**

**Input**: Optionally specify layer filter (unit, integration, llm), suite names, or flags like --mock, --ci.

**Steps**

1. **Check prerequisites**

   ```bash
   cd <workspace-root>
   ls plugin-eval.yaml
   ```

   If `plugin-eval.yaml` doesn't exist → invoke the **framework-assistant** skill to generate comprehensive coverage first.
   If `node_modules` is missing → run `npm install`.

2. **Check and set up infrastructure**

   If running integration, performance, or LLM tests without --mock:

   a. Load test env: `set -a && source .env.test && set +a` (if .env.test exists)

   b. Check Docker infrastructure:
   ```bash
   # If docker-compose exists, start it
   if [ -f docker/docker-compose.yml ]; then
     docker compose -f docker/docker-compose.yml up -d --wait
   fi
   ```

   c. If docker-compose does NOT exist but integration tests use `require_env` with service URLs:
      → Create the full e2e infrastructure (docker-compose, seed script, .env.test, run script)
      → See the framework-assistant skill Phase 1.5 for the exact template

   d. Seed test data if seed script exists:
   ```bash
   [ -f scripts/seed-test-data.sh ] && bash scripts/seed-test-data.sh
   ```

   e. Run doctor check:
   ```bash
   npx cursor-plugin-evals doctor
   ```
   If env vars are missing, flag which layers will be skipped.

3. **Run the evaluation**

   ```bash
   npx cursor-plugin-evals run [options] --verbose
   ```

4. **Analyze + Auto-Fix failures (THE CONVERGENCE LOOP)**

   After the run completes, if ANY test fails:

   ```
   REPEAT (max 5 iterations):
     a. Read failure details — which tests, which evaluators, what scores
     b. Classify each failure:
        - Config issue (wrong expected, bad assertion) → fix YAML immediately
        - Plugin bug (tool genuinely broken) → flag to user
        - Infrastructure issue (service down, env missing) → add require_env/skip
        - Flaky (inconsistent across reps) → increase repetitions to 3
        - Threshold too strict → relax threshold for that specific test
     c. Apply ALL fixes to plugin-eval.yaml
     d. Re-run ONLY the failing suites:
        `npx cursor-plugin-evals run --suite FAILING_SUITE --verbose`
     e. If new failures appear → add to fix list and continue
     f. If same failures persist with same scores → change approach:
        - Rewrite the prompt (for LLM tests)
        - Change the assertion operator (for integration tests)
        - Adjust the evaluator weights
     g. If all tests pass → exit loop
   ```

5. **Run full CI check after all layers pass**

   ```bash
   npx cursor-plugin-evals run --ci
   ```

   If CI fails:
   - Identify which gate failed (score.avg, requiredPass, firstTryPassRate, etc.)
   - Fix the underlying tests causing the gate failure
   - Re-run `--ci` until exit code 0

6. **Report final state**

   ```
   ## Plugin Eval Results

   **Status:** ✅ All CI thresholds passing
   **Pass Rate:** XX% (XX/XX tests)
   **Iterations:** N fix cycles needed
   **CI Score:** X.XX (threshold: Y.YY)

   ### Fixes Applied During Convergence
   1. Updated esql_query assertion to match new response format
   2. Increased timeout for cloud_api tests (was 5s, now 15s)
   3. Added require_env to integration tests for service dependencies
   ```

7. **Calibrate thresholds (MANDATORY after convergence)**

   Once all CI gates pass, analyze whether the thresholds are properly calibrated.
   Lenient thresholds provide false confidence and allow regressions to slip through.

   a. For each CI gate, compute headroom:
      - `headroom = actual_score - threshold_value`

   b. Apply tightening rules:
      | Headroom | Action |
      |----------|--------|
      | > 20% above threshold | **Bump** to `actual - 5%` |
      | 10-20% above | **Bump** if stable across run |
      | 5-10% above | Well calibrated — leave |
      | < 5% above | Tight — leave, monitor |
      | `security.min = 1.0` | NEVER lower |

   c. Identify weakest tests dragging averages down — fix those tests
      rather than keeping thresholds low to accommodate them

   d. Update `plugin-eval.yaml` with tighter thresholds

   e. Re-run to confirm:
   ```bash
   npx cursor-plugin-evals run --ci
   ```
   If tighter thresholds fail due to variance, back off by 2% and retry.

   f. Report calibration:
   ```
   ## Threshold Calibration
   | Gate | Old | Actual | New | Headroom |
   |------|-----|--------|-----|----------|
   | score.avg | 0.80 | 0.94 | 0.89 | 5.6% |
   | tool-selection.avg | 0.80 | 0.97 | 0.92 | 5.4% |
   ```

8. **Commit green + calibrated state**

   After convergence AND calibration, commit the updated plugin-eval.yaml so the
   passing state with properly-tight thresholds is preserved.

**Auto-Fix Reference**

| Failure Pattern | Automatic Fix |
|----------------|---------------|
| `expected tool X but got Y` | Update `expected.tools` to match actual |
| `assertion failed: field Z` | Update assertion to match actual response structure |
| `content[0].text undefined` | Change assertion path to `content.0.text` (dot notation) |
| `Unresolved environment variable: X:-Y` | Remove bash default syntax; use plain `${X}` and set default in .env.test |
| `scoring.weights.X too big` | Reduce weight to ≤ 1.0 |
| `Unknown field camelCase` | Convert to snake_case (e.g., `expectedTools` → `expected_tools`) |
| `timeout exceeded` | Double the timeout value |
| `tool not found` | Check registration; update test or add conditional env |
| `score 0.7 below threshold 0.8` | Fix test if possible; relax per-test threshold if not |
| `security evaluator: 0.5` | Review prompt — ensure it's genuinely adversarial |
| `connection refused` | Add `require_env` to skip when service unavailable |
| `inconsistent results` | Set `repetitions: 3` and use median score |

**Guardrails**
- Max 5 fix iterations per layer — escalate to user if still failing
- Never remove tests — skip with reason or fix them
- Never modify plugin source code — only eval config
- Always run doctor before integration/llm tests
- Commit only after all CI thresholds pass
