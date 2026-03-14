---
name: debug-eval-failure
description: Automatically debug and fix failing plugin evaluation tests. Diagnoses root cause, applies fix, re-runs to verify — no manual intervention needed. Use when a plugin eval fails, a test is broken, quality drops, or the user says "debug eval", "fix test", "why is this failing", "test is broken".
license: MIT
metadata:
  author: cursor-plugin-evals
  version: "2.0"
---

Automatically debug, fix, and verify failing plugin evaluation tests. Does NOT just diagnose — implements the fix and re-runs to confirm.

**Input**: Failing test name, suite name, or error message. If not provided, run evals first to identify failures.

**Steps**

1. **Identify failures**

   If not already known, run evals:
   ```bash
   npx cursor-plugin-evals run --verbose
   ```
   Read output and collect ALL failing tests.

2. **Classify each failure**

   | Type | Symptoms | Auto-Fixable? |
   |------|----------|---------------|
   | wrong-tool | LLM selected wrong tool | Yes — improve prompt or fix expected.tools |
   | wrong-args | Correct tool, wrong arguments | Yes — update expected.toolArgs |
   | assertion-fail | Integration assertion mismatch | Yes — update assertion to match actual |
   | timeout | Call exceeded time limit | Yes — increase timeout |
   | mcp-error | Connection/protocol error | Maybe — check build, add require_env |
   | yaml-convention | camelCase keys silently ignored | Yes — convert to snake_case |
   | infra-missing | No backend services for integration tests | Yes — create docker-compose + seed |
   | assertion-path | content[0] returns undefined | Yes — change to content.0.text |
   | security-leak | Sensitive data in output | Yes — update expected response |
   | schema-drift | Tool schema changed | Yes — update schema assertions |
   | flaky | Inconsistent results | Yes — increase repetitions |
   | **framework-limitation** | Evaluator scores wrong due to adapter mismatch, missing skip logic, or config expressiveness gap | **STOP — propose framework fix** |

   **CRITICAL: framework-limitation detection.** Before classifying any failure as one of
   the above types, first check: is the root cause actually a framework limitation? Signals:
   - An evaluator returns 0.0 or 1.0 because it lacks context about the adapter
   - A workaround (removing evaluator, duplicating config, loosening threshold) is the only "fix"
   - The same pattern keeps appearing across different test suites
   - You're about to do something from the anti-pattern list (see below)

   If it's a framework limitation → classify as `framework-limitation` and proceed to step 3a.

3. **Apply fixes immediately (for EACH failure)**

   **framework-limitation (HANDLE FIRST — before all other fix types):**
   - STOP applying workarounds
   - Identify the root cause in framework source (types, evaluators, adapters, config schema)
   - Propose the fix: what changes, proposed API, effort (S/M/L), backward compatibility
   - Ask: "This is a framework limitation blocking correct results. Want me to fix the framework first?"
   - If approved → implement in framework source, run `npm test`, update docs, then resume debugging
   - If deferred → document in YAML comment, apply best available workaround

   **wrong-tool:**
   - Read the prompt and check if it's ambiguous
   - Make the prompt more specific (add tool name hints if needed)
   - If the LLM's tool choice is actually reasonable, update expected.tools
   - Apply fix to plugin-eval.yaml

   **wrong-args:**
   - Read the tool's current schema from source
   - Update expected.toolArgs to match current schema
   - Apply fix to plugin-eval.yaml

   **assertion-fail:**
   - Run the tool manually to see actual response format
   - Update assertions to match the real response structure
   - Apply fix to plugin-eval.yaml

   **timeout:**
   - Double the test's timeout value
   - Apply fix to plugin-eval.yaml

   **mcp-error:**
   - Check if plugin builds: `cd $PLUGIN_DIR && npm run build`
   - If env var missing, add `require_env` to the test/suite
   - Check if docker infrastructure exists — if not, create it
   - Ensure `.env.test` is loaded: `set -a && source .env.test && set +a`
   - Apply fix to plugin-eval.yaml

   **yaml-convention:**
   - Convert ALL camelCase field names to snake_case
   - Convert `content[0].text` assertion paths to `content.0.text`
   - Ensure scoring weights ≤ 1.0
   - Remove `${VAR:-default}` env syntax — use plain `${VAR}`
   - Apply ALL fixes to plugin-eval.yaml

   **infra-missing:**
   - Create `docker/docker-compose.yml` with required backend services + setup container
   - Create `scripts/seed-test-data.sh` with domain-specific data
   - Create `.env.test` with test credentials
   - Create `scripts/run-evals.sh` orchestration script

   **schema-drift:**
   - Re-read the current tool schema from source
   - Update all schema-dependent assertions and expectations
   - Apply fix to plugin-eval.yaml

   **flaky:**
   - Set `repetitions: 3` on the test
   - If variance is in LLM response, reduce temperature
   - Apply fix to plugin-eval.yaml

4. **Verify every fix by re-running**

   After applying ALL fixes:
   ```bash
   npx cursor-plugin-evals run --suite <affected-suite> --verbose
   ```

   If still failing → iterate (up to 3 more times):
   - Re-read failure details
   - Try a different fix strategy
   - Re-run again

5. **Run full CI to confirm no regressions**

   ```bash
   npx cursor-plugin-evals run --ci
   ```

   If CI gate fails → fix the gate-failing tests and re-run.

6. **Commit the green state**

   Once everything passes, commit the updated plugin-eval.yaml.

**Output**

```
## Eval Debug Complete

**Fixed:** N/M failures resolved
**Iterations:** X fix cycles
**CI Status:** ✅ All thresholds passing

### Fixes Applied
1. [wrong-tool] discovery-data-prompt: Updated expected.tools from [discover_data] to [discover_o11y_data]
2. [assertion-fail] es-cluster-health: Updated assertion from "green" to match JSON structure
3. [timeout] cloud-api-deployment: Increased timeout from 10s to 30s

### Remaining (requires human)
- [mcp-error] agent-builder tools: Plugin server crashes on startup without AGENT_BUILDER_URL
```

**Guardrails**
- Max 5 fix iterations total — escalate remaining to user
- Never modify plugin source — only eval config
- Never remove tests — fix or skip with reason
- Always re-run to verify after fixing
- Always run full CI check before declaring done
- **Never silently work around framework limitations** — always propose framework fixes first
- Anti-pattern watchlist (if you're about to do any of these, it's a framework limitation):
  - Removing an evaluator from eval.yaml because the adapter doesn't support it
  - Setting `score: 1` for inapplicable checks
  - Duplicating eval.yaml per adapter
  - Loosening CI thresholds to compensate for evaluator bugs
  - Accepting false positives/negatives
