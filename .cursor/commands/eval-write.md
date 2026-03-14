---
description: Write new evaluation test suites for the plugin
---

# Write Eval Suite

Generate new test suites for uncovered tools, workflows, or quality dimensions.

## Usage

```
/eval:write [tool-names or domain]
```

## Examples

- `/eval:write` — Analyze coverage gaps and generate suites
- `/eval:write elasticsearch_api esql_query` — Write tests for specific tools
- `/eval:write security` — Write security-focused test suites
- `/eval:write error-handling` — Write error/edge case tests

## What it does

1. Discovers all plugin tools via MCP
2. Analyzes existing test coverage in plugin-eval.yaml
3. Identifies gaps (untested tools, missing error cases, no LLM evals)
4. Generates targeted test suites
5. Validates new suites pass
6. Records fixtures for mock mode
