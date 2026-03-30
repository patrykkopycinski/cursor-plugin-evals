# Custom Evaluators

Write evaluators in any language. The custom evaluator protocol uses stdin/stdout JSON to communicate with evaluator subprocesses.

## Quick Start

```bash
# Scaffold a Python evaluator
cursor-plugin-evals evaluator init --name my-scorer --language python

# Creates:
#   evaluators/my-scorer/evaluator.json  (manifest)
#   evaluators/my-scorer/evaluator.py    (your scoring logic)
#   evaluators/my-scorer/README.md       (usage guide)
```

## Supported Languages

| Language | Extension | Runtime |
|----------|-----------|---------|
| TypeScript | `.ts` | `npx tsx` |
| JavaScript | `.js`, `.mjs` | `node` |
| Python | `.py` | `python3` |
| Shell | `.sh` | `sh` |
| Go | `.go` | `go run` |

## Protocol

**Input (stdin):** Full evaluation context as JSON:

```json
{
  "protocol_version": "1.0",
  "evaluator_name": "my-scorer",
  "test_name": "check-search",
  "prompt": "Find documents about...",
  "final_output": "Here are the results...",
  "tool_calls": [
    { "tool": "search", "args": {"query": "..."}, "result": {"content": "...", "is_error": false}, "latency_ms": 450 }
  ],
  "expected": { "tools": ["search"], "response_contains": ["results"] },
  "token_usage": { "input": 500, "output": 200 },
  "latency_ms": 1200,
  "adapter": "mcp",
  "config": { "custom_key": "value" },
  "messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
}
```

**Output (stdout):** Score and metadata as JSON:

```json
{
  "protocol_version": "1.0",
  "score": 0.85,
  "pass": true,
  "label": "good",
  "explanation": "Response contains expected keywords",
  "metadata": { "matched_keywords": 4, "total_keywords": 5 }
}
```

## YAML Configuration

```yaml
suites:
  - name: custom-tests
    evaluators:
      add:
        - name: custom
          path: ./evaluators/my-scorer       # directory with evaluator.json
          threshold: 0.7
          config:
            strict_mode: true
        - name: custom
          path: ./evaluators/quick-check.py  # single file
          runtime: python
```

## Manifest (evaluator.json)

```json
{
  "name": "my-scorer",
  "version": "1.0.0",
  "description": "Checks response quality against domain rules",
  "language": "python",
  "entry": "evaluator.py",
  "protocol_version": "1.0"
}
```
