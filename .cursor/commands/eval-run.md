---
description: Run plugin evaluation suites with specified options
---

# Run Plugin Evals

Run the cursor-plugin-evals test suites against the configured plugin.

## Usage

```
/eval:run [--layer <unit|integration|llm>] [--suite <name>] [--mock] [--ci]
```

## Examples

- `/eval:run` — Run all test suites
- `/eval:run --layer unit` — Run only unit tests
- `/eval:run --mock` — Run with recorded fixtures (no live cluster needed)
- `/eval:run --ci` — CI mode with threshold enforcement
- `/eval:run --suite gateway-tools` — Run specific suite

## What it does

1. Loads `plugin-eval.yaml` configuration
2. Checks infrastructure health (for integration/llm layers)
3. Runs filtered test suites through the appropriate layer
4. Reports results with pass/fail per test and evaluator scores
5. In CI mode, exits non-zero if thresholds aren't met
