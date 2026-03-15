---
name: record-fixtures
description: Record MCP tool call fixtures for mock-mode testing. Use when the user wants to record fixtures, update recordings, enable mock mode, or says "record", "update fixtures", "mock mode", "offline testing".
license: MIT
metadata:
  author: cursor-plugin-evals
  version: "1.0"
---

Record MCP tool call/response fixtures for offline and mock-mode testing.

**Input**: Suite name(s) to record. If not specified, record all suites.

**Steps**

1. **Verify live infrastructure**

   Recording requires a live cluster:
   ```bash
   npx cursor-plugin-evals doctor
   ```

   If services aren't running:
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```

2. **Run recording**

   ```bash
   npx cursor-plugin-evals record [--suite <name>]
   ```

   This executes all integration and LLM eval tests against the live cluster while capturing every MCP tool call/response pair.

3. **Verify recordings**

   Check the fixture directory:
   ```bash
   ls -la fixtures/
   ```

   Each tool gets its own `.jsonl.gz` file containing recorded call/response pairs.

4. **Test mock mode**

   Verify recordings work:
   ```bash
   npx cursor-plugin-evals run --mock --suite <name>
   ```

5. **Commit fixtures**

   If recordings look good:
   ```bash
   git add fixtures/
   git commit -m "Update eval fixtures"
   ```

**When to re-record**
- After plugin tool response formats change
- After adding new test cases
- After cluster data changes
- When fixture freshness warnings appear (>14 days old)

## MCP Tools (Preferred)

When the `cursor-plugin-evals` MCP server is connected:

| Instead of CLI | Use MCP tool |
|---|---|
| `npx cursor-plugin-evals doctor` | `doctor` |

**Output**

```
## Fixture Recording Complete

Recorded 23 tool call/response pairs across 3 suites:
- gateway-tools: 5 recordings
- security-operations: 12 recordings
- discovery-workflows: 6 recordings

Fixture directory: fixtures/
Mock mode verified: 21/23 exact matches, 2 fuzzy matches
```
