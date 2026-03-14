---
description: Generate evaluation tests — use schema-walking, smart generation, conversations, traces, or red-team scanning to fill coverage gaps.
argumentHint: "[strategy] [tool-name]"
---

Use the **eval-generator** skill to generate tests. Available strategies:

- **schema** — deterministic tests from tool JSON schemas (integration layer)
- **smart** — LLM-powered tests with personas (LLM layer)
- **conversations** — multi-turn conversation tests
- **traces** — tests from OpenTelemetry production traces
- **red-team** — adversarial security test cases
- **auto** — automatically choose strategies based on coverage gaps

If a tool name is provided, generate tests specifically for that tool.
If no arguments, analyze coverage gaps and generate tests to fill them.

Generated tests are appended to existing suites — never overwriting.
