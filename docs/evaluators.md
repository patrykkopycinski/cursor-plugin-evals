# Evaluators Reference

Complete reference for all 32 evaluators. Each evaluator scores a specific quality dimension from 0 to 1.

Evaluators are divided into two kinds:
- **CODE** — deterministic, rule-based scoring (fast, no LLM call)
- **LLM** — LLM-judged scoring (requires an API key, configurable via `defaults.judge_model`)

## CODE Evaluators

### tool-selection

Checks whether the agent called the correct tools.

- **Scores:** Jaccard similarity between expected and actual tool sets
- **Default threshold:** `0.8`
- **Requires:** `expected.tools`

```yaml
evaluators: [tool-selection]
expected:
  tools: [search_tool, query_tool]
```

### tool-args

Validates that tool calls used correct arguments.

- **Scores:** Fraction of expected argument key-value pairs found in actual calls
- **Default threshold:** `0.7`
- **Requires:** `expected.toolArgs`

```yaml
evaluators: [tool-args]
expected:
  toolArgs:
    search_tool:
      method: GET
```

### tool-sequence

Checks the order of tool calls.

- **Scores:** Longest common subsequence ratio between expected and actual sequences
- **Default threshold:** `0.8`
- **Requires:** `expected.toolSequence`

```yaml
evaluators: [tool-sequence]
expected:
  toolSequence: [search_tool, search_tool, query_tool]
```

### response-quality

Scores the final text response on completeness and helpfulness.

- **Scores:** Composite of length adequacy, keyword coverage, and structure
- **Default threshold:** `0.7`

```yaml
evaluators: [response-quality]
expected:
  responseContains: ["results", "found"]
```

### path-efficiency

Measures how closely the agent's tool call path matches the golden (ideal) path.

- **Scores:** 1 - (edit distance / max path length)
- **Default threshold:** `0.6`
- **Requires:** `expected.goldenPath`

```yaml
evaluators: [path-efficiency]
expected:
  goldenPath: [search_tool, search_tool]
```

### cluster-state

Verifies external state (e.g., a backend service) after tool calls.

- **Scores:** Fraction of state assertions that pass
- **Default threshold:** `0.9`
- **Requires:** `expected.clusterState`

```yaml
evaluators: [cluster-state]
expected:
  clusterState:
    - method: GET
      path: /test-index/_count
      assert:
        - field: count
          op: gt
          value: 0
```

### mcp-protocol

Validates that tool calls and responses conform to the MCP protocol specification.

- **Scores:** Fraction of calls with valid MCP request/response structure
- **Default threshold:** `0.9`

```yaml
evaluators: [mcp-protocol]
```

### security

Checks for security violations — leaked secrets, unauthorized operations, and excessive permissions.

- **Scores:** 1 if no violations found, 0 per violation
- **Default threshold:** `1.0`

```yaml
evaluators: [security]
```

### tool-poisoning

Detects if the agent was tricked into calling tools with malicious arguments (e.g., via prompt injection in tool results).

- **Scores:** 1 if no poisoned calls detected, 0 otherwise
- **Default threshold:** `1.0`

```yaml
evaluators: [tool-poisoning]
```

### skill-trigger

Verifies that the correct skill was activated for the given prompt.

- **Scores:** 1 if the expected skill was triggered, 0 otherwise
- **Default threshold:** `0.8`

```yaml
evaluators: [skill-trigger]
```

### content-quality

Evaluates the structural quality of the response — formatting, coherence, and completeness.

- **Scores:** Composite of formatting, structure, and content metrics
- **Default threshold:** `0.7`

```yaml
evaluators: [content-quality]
```

### keywords

Checks for the presence of expected keywords in the response.

- **Scores:** Fraction of expected keywords found
- **Default threshold:** `0.7`

```yaml
evaluators: [keywords]
expected:
  responseContains: ["item", "mapping", "record"]
```

### rag

Evaluates retrieval-augmented generation quality with precision, recall, and faithfulness metrics.

- **Scores:** Composite RAG score
- **Default threshold:** `0.7`

```yaml
evaluators: [rag]
```

### visual-regression

Compares screenshots against baselines for pixel-level regressions.

- **Scores:** 1 - (diff pixel ratio)
- **Default threshold:** `0.95`

```yaml
evaluators: [visual-regression]
```

### esql-execution

Executes the generated ES|QL query against a live Elasticsearch cluster and scores based on execution success.

- **Scores:** `1.0` if query executes, `0.4` for `index_not_found` (valid syntax, wrong index), `0` for errors
- **Default threshold:** `0.5`
- **Requires:** `ELASTICSEARCH_URL` or `config.esUrl`

```yaml
evaluators: [esql-execution]
```

Extracts ES|QL from the LLM output automatically (fenced blocks, bare pipe syntax). Partial credit for valid syntax that references a non-existent index rewards correct ES|QL grammar even when the model guesses wrong index names.

### esql-pattern

Regex-based pattern matching against the generated ES|QL query with equivalence class support.

- **Scores:** Fraction of patterns matched (with equivalence substitution)
- **Default threshold:** `0.7`
- **Requires:** `expected.responseContains` (patterns)

```yaml
evaluators: [esql-pattern]
expected:
  response_contains:
    - "STATS"
    - "SORT.*DESC"
    - "LIMIT 10"
```

Equivalence classes: `LOOKUP JOIN` ≈ `ENRICH`, `DISSECT` ≈ `GROK`, `MATCH` ≈ `QSTR`, `MV_EXPAND` ≈ `MV_SORT`. If a pattern specifies one command, its equivalent is also accepted.

### esql-result

Compares result sets between the generated ES|QL query and a golden reference query, both executed against a live cluster.

- **Scores:** Average of column overlap + row count similarity
- **Default threshold:** `0.7`
- **Requires:** `expected.esqlGolden` (reference query), `ELASTICSEARCH_URL` or `config.esUrl`

```yaml
evaluators: [esql-result]
expected:
  esql_golden: |
    FROM logs-test
    | KEEP @timestamp, level, message
    | SORT @timestamp DESC
    | LIMIT 10
```

Column overlap measures the fraction of reference columns present in the generated output (case-insensitive, extra columns don't penalize). Row count similarity is `1 - |gen - ref| / ref`.

## LLM Evaluators

### correctness

LLM judge compares the actual output against the expected output for factual accuracy.

- **Scores:** 0–1 judge rating
- **Default threshold:** `0.7`

```yaml
evaluators: [correctness]
```

### groundedness

LLM judge checks whether the response is grounded in the tool call results (no hallucinated facts).

- **Scores:** 0–1 judge rating
- **Default threshold:** `0.7`

```yaml
evaluators: [groundedness]
```

### g-eval

General-purpose LLM evaluation using the G-Eval framework with chain-of-thought scoring.

- **Scores:** 0–1 judge rating
- **Default threshold:** `0.7`

```yaml
evaluators: [g-eval]
```

### similarity

Semantic similarity between actual and expected output using LLM embedding comparison.

- **Scores:** Cosine similarity (0–1)
- **Default threshold:** `0.7`

```yaml
evaluators: [similarity]
```

### context-faithfulness

LLM judge evaluates whether the response stays faithful to the provided context without adding unsupported claims.

- **Scores:** 0–1 judge rating
- **Default threshold:** `0.7`

```yaml
evaluators: [context-faithfulness]
```

### conversation-coherence

LLM judge scores multi-turn conversations on relevance, consistency, and goal progression.

- **Scores:** Average of `turn_relevance`, `consistency`, and `goal_progression`
- **Default threshold:** `0.7`

```yaml
evaluators: [conversation-coherence]
```

See [Multi-Turn Conversations](./conversations.md) for details.

### criteria

Custom criteria evaluation — provide your own rubric and the LLM judge scores against it.

- **Scores:** 0–1 judge rating per criterion
- **Default threshold:** `0.7`

```yaml
evaluators: [criteria]
```

### plan-quality

LLM judge evaluates the quality of plans or step-by-step instructions.

- **Scores:** Composite of completeness, ordering, and feasibility
- **Default threshold:** `0.7`

```yaml
evaluators: [plan-quality]
```

### task-completion

LLM judge assesses whether the overall task goal was achieved.

- **Scores:** 0–1 judge rating
- **Default threshold:** `0.8`

```yaml
evaluators: [task-completion]
```

### script

Runs an arbitrary shell command and parses JSON output. Ideal for quick deterministic checks like file existence, keyword grep, or structural validation — matching Skillgrade's inline bash grader pattern.

- **Scores:** Parsed from script JSON output `{"score": 0.0-1.0}`
- **Default threshold:** `0.5`
- **Requires:** `config.run` (shell command)

```yaml
evaluators: [script]
config:
  run: |
    score=0
    if grep -qi "FROM.*logs" query.esql; then score=$((score+1)); fi
    if grep -qi "LIMIT" query.esql; then score=$((score+1)); fi
    echo "{\"score\": $(echo "scale=2; $score/2" | bc)}"
  threshold: 0.8
```

**Environment variables available to script:**
- `EVAL_OUTPUT` — the agent's final output
- `EVAL_PROMPT` — the original prompt
- `EVAL_TEST_NAME` — the test name

**Expected JSON output:** `{"score": 0.0-1.0, "label": "optional", "explanation": "optional"}`

### token-usage

Validates token consumption stays within configured limits.

- **Scores:** Based on whether input/output/total tokens stay within thresholds
- **Default threshold:** Configurable via `defaults.thresholds.token-usage`
- **Requires:** Token usage data from adapter

### trajectory

Scores the quality of the agent's decision path.

- **Scores:** Composite of decision quality metrics
- **Default threshold:** `0.7`

### resistance

Tests adversarial prompt injection resistance.

- **Scores:** Based on whether the agent resists injection attempts
- **Default threshold:** `0.9`

### workflow

Validates file modifications and workflow patterns.

- **Scores:** Based on expected file operations and output patterns
- **Requires:** `defaults.thresholds.workflow` configuration

## Programmatic API

```typescript
import { createEvaluator, EVALUATOR_NAMES } from 'cursor-plugin-evals';
import type { EvaluatorContext } from 'cursor-plugin-evals';

// List all evaluators
console.log(EVALUATOR_NAMES); // ['tool-selection', 'tool-args', ...]

// Create and run an evaluator
const evaluator = createEvaluator('tool-selection');
const result = await evaluator.evaluate({
  testName: 'my-test',
  prompt: 'Search for errors',
  toolCalls: [{ tool: 'search_tool', args: { query: 'errors' }, result: { content: [] }, latencyMs: 100 }],
  finalOutput: 'Found 10 errors',
  expected: { tools: ['search_tool'] },
  adapterName: 'mcp',
  adapterCapabilities: {
    hasToolCalls: true,
    hasFileAccess: false,
    hasWorkspaceIsolation: false,
    reportsInputTokens: true,
  },
});

console.log(`${result.evaluator}: ${result.score} (${result.pass ? 'PASS' : 'FAIL'})`);
// result.skipped === true means the evaluator was not applicable
```

## Evaluator Result Skipping

Evaluators can return `skipped: true` when they cannot meaningfully score in the current context.
Skipped results are excluded from all aggregation (CI thresholds, leaderboards, quality scores).

This happens automatically when:
- **groundedness** runs without tool calls (e.g., with `plain-llm` adapter)
- **workflow** has no workflow checks configured
- **token-usage** has no token usage data

```typescript
interface EvaluatorResult {
  evaluator: string;
  score: number;
  pass: boolean;
  skipped?: boolean;     // NEW — excluded from aggregation when true
  label?: string;
  explanation?: string;
  metadata?: Record<string, unknown>;
}
```

## Adapter-Aware Context

Evaluators receive adapter information in their context, enabling them to auto-skip
or adjust behavior based on adapter capabilities:

```typescript
interface EvaluatorContext {
  // ... existing fields ...
  adapterName?: string;             // 'plain-llm', 'cursor-cli', 'mcp', etc.
  adapterCapabilities?: {
    hasToolCalls: boolean;           // Can the adapter make tool calls?
    hasFileAccess: boolean;          // Can it read/write files?
    hasWorkspaceIsolation: boolean;  // Does it create isolated workspaces?
    reportsInputTokens: boolean;     // Does it report real input token counts?
  };
}
```

## Typed Evaluator Configurations

Evaluators that accept complex configuration via `defaults.thresholds` use typed schemas:

```yaml
defaults:
  thresholds:
    token-usage:                # TokenUsageConfig
      max_input: 5000
      max_output: 12000
      max_total: 15000
    workflow:                   # WorkflowConfig
      tools_used: [read_file]
      files_read: [checklist.md]
      files_written: [report.md]
      output_patterns: ["CRITICAL"]
    security:                   # SecurityConfig
      exclude_locations: [finalOutput]
      domain: security-review
    groundedness: 0.8           # Simple threshold (number) or GroundednessConfig
```

Import typed resolvers for programmatic use:

```typescript
import {
  resolveTokenUsageConfig,
  resolveWorkflowConfig,
  resolveSecurityConfig,
  resolveGroundednessConfig,
} from 'cursor-plugin-evals';
```

## See Also

- [LLM Eval Layer](./layers/llm.md)
- [Skill Eval Layer](./layers/skill.md)
- [Configuration Reference](./configuration.md)
