---
description: Record fixtures for mock-mode testing
---

# Record Eval Fixtures

Record MCP tool call/response pairs from a live cluster for offline testing.

## Usage

```
/eval:record [--suite <name>]
```

## Examples

- `/eval:record` — Record all suites
- `/eval:record --suite gateway-tools` — Record specific suite

## What it does

1. Verifies live cluster infrastructure is healthy
2. Runs integration and LLM eval suites against the live cluster
3. Captures every MCP tool call/response as compressed JSONL fixtures
4. Verifies recordings work in mock mode
5. Reports recording stats (count, size, match quality)
