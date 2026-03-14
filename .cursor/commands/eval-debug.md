---
description: Debug and fix a failing plugin eval test
---

# Debug Eval Failure

Investigate and fix a failing test from the plugin evaluation suite.

## Usage

```
/eval:debug [test-name or suite-name]
```

## Examples

- `/eval:debug` — Find and debug all failures
- `/eval:debug gateway-tools` — Debug failures in the gateway-tools suite
- `/eval:debug esql-simple-query` — Debug a specific test

## What it does

1. Runs evals to identify failures (or uses the specified test/suite)
2. Classifies failure type (wrong-tool, assertion-fail, timeout, etc.)
3. Investigates root cause based on failure type
4. Applies targeted fix (config, plugin, fixture, or prompt)
5. Re-runs to verify the fix
