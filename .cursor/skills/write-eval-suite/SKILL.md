---
name: write-eval-suite
description: Write new evaluation test suites for a Cursor plugin. Use when the user wants to add tests, write eval suites, test new tools, cover new scenarios, or says "add test", "write eval", "test coverage", "new suite".
license: MIT
metadata:
  author: cursor-plugin-evals
  version: "1.0"
---

Write new evaluation test suites for a Cursor plugin by discovering tools and generating targeted tests.

**Input**: What to test — specific tools, workflows, or quality dimensions. If not specified, generate comprehensive coverage.

**Steps**

1. **Discover available tools**

   Connect to the plugin and list all tools:
   ```bash
   npx cursor-plugin-evals generate --config /tmp/discovery.yaml
   ```

   Or if the plugin is already configured, read the existing plugin-eval.yaml to understand current coverage.

2. **Identify coverage gaps**

   Compare discovered tools against existing test suites:
   - Which tools have no integration tests?
   - Which tools have no LLM eval tests?
   - Are error cases covered?
   - Are workflow chains tested?

3. **Design test cases by layer**

   **Unit tests** — one-time validation:
   - Registration: all expected tools present
   - Schema: all tools have valid inputSchema
   - Conditional registration: env-dependent tools

   **Integration tests** — tool correctness:
   - Happy path for each tool
   - Error cases (invalid args, missing auth, nonexistent resources)
   - Workflow chains (multi-tool sequences)
   - Response format validation

   **LLM eval tests** — agent quality:
   - Natural language prompts for common user requests
   - Expected tool selections
   - Tool argument accuracy
   - Response quality for complex queries
   - Security (no credential leaks)

4. **Write the suite configuration**

   Add suites to plugin-eval.yaml following this structure:
   ```yaml
   - name: <descriptive-name>
     layer: <unit|integration|llm>
     defaults:
       timeout: 30000
     tests:
       - name: <test-name>
         # ... layer-specific fields
   ```

   For each test, define:
   - Clear, descriptive name
   - Appropriate assertions or expected outputs
   - Relevant evaluators (for LLM tests)

5. **Validate the new suite**

   Run only the new suite to verify it works:
   ```bash
   npx cursor-plugin-evals run --suite <new-suite-name>
   ```

6. **Record fixtures if needed**

   For integration tests that should work in mock mode:
   ```bash
   npx cursor-plugin-evals record --suite <new-suite-name>
   ```

**Output**

```
## New Eval Suite: security-operations

Added 8 tests across 2 suites:

### security-rules (integration)
- list-detection-rules: GET all rules via manage_detection_rules
- create-detection-rule: POST new rule, verify creation
- delete-detection-rule: DELETE rule, verify removal
- invalid-rule-id: GET nonexistent rule returns error

### security-agent (llm)
- find-active-rules: "Show me active detection rules" → manage_detection_rules
- create-rule-prompt: "Create a rule to detect brute force" → manage_detection_rules
- triage-alerts: "What alerts fired in the last hour?" → triage_alerts
- security-overview: "Give me a security overview" → discover_security_data

All tests validated ✓
```

**Guidelines for good test design**
- Test one thing per test
- Use descriptive names that explain what's being tested
- For LLM tests, write natural language prompts (not tool-call syntax)
- Include both positive and negative test cases
- Set realistic thresholds (0.9 for tool selection, 0.7 for response quality)
- Group related tests into suites by domain
