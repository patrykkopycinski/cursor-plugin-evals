# Skill Eval Layer

Evaluate skills using dataset-driven tests with multiple task adapters and per-example evaluators.

## eval.yaml Format

Each skill directory can contain an `eval.yaml` dataset alongside `SKILL.md`:

```yaml
name: search-skill
description: "Evaluate the search skill"
examples:
  - input:
      prompt: "Find all error logs from the last hour"
    output: "The search results show..."
    metadata:
      difficulty: simple
      tags: [search, logs]
  - input:
      prompt: "Create a visualization of CPU usage trends"
    output: "Here is the CPU usage dashboard..."
    metadata:
      difficulty: complex
      tags: [visualization, metrics]

adapters: [mcp, plain-llm]
evaluators: [correctness, groundedness]

defaults:
  maxTurns: 10
  timeout: 60000
  repetitions: 2
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Dataset name |
| `description` | string | Human-readable description |
| `examples` | array | Test examples with `input`, `output`, and optional `metadata` |
| `adapters` | string[] | Adapters to run each example through |
| `evaluators` | string[] | Evaluators to score each output |
| `defaults` | object | Override maxTurns, timeout, repetitions |

## Multi-Adapter Support

Run the same examples through different execution backends:

```yaml
adapters:
  - mcp          # Full MCP agent loop
  - plain-llm    # Direct LLM call without tools
  - headless-coder  # Headless coding agent
```

Each adapter produces a `TaskOutput` with messages, tool calls, and the final output. Results are tagged with the adapter name for comparison.

## Per-Example Overrides

Override evaluators or metadata per example:

```yaml
examples:
  - input:
      prompt: "Delete the test index"
    output: "Index deleted"
    metadata:
      evaluators: [correctness, security]
      difficulty: adversarial
```

## Available Evaluators

Skill evals commonly use these evaluators:

| Evaluator | What It Checks |
|-----------|---------------|
| `correctness` | LLM judge compares actual output to expected output |
| `groundedness` | LLM judge checks output is grounded in tool call results |
| `similarity` | Semantic similarity between actual and expected output |
| `keywords` | Checks for presence of expected keywords |
| `task-completion` | LLM judge assesses whether the task goal was achieved |
| `tool-selection` | Correct tools were called |

See [Evaluators](../evaluators.md) for the full list.

## CLI Usage

```bash
# Run skill eval for a specific skill directory
cursor-plugin-evals skill-eval --skill-dir ./skills/search-skill

# Use specific adapters
cursor-plugin-evals skill-eval --skill-dir ./skills/search-skill -a mcp plain-llm

# Use specific evaluators
cursor-plugin-evals skill-eval --skill-dir ./skills/search-skill -e correctness groundedness

# Override repetitions
cursor-plugin-evals skill-eval --skill-dir ./skills/search-skill -r 3

# Output as JSON
cursor-plugin-evals skill-eval --skill-dir ./skills/search-skill --report json -o results.json
```

## Programmatic API

```typescript
import { runSkillSuite, createEvaluator, loadSkillDataset } from 'cursor-plugin-evals';
import type { Evaluator } from 'cursor-plugin-evals';

const evaluatorRegistry = new Map<string, Evaluator>();
evaluatorRegistry.set('correctness', createEvaluator('correctness'));
evaluatorRegistry.set('groundedness', createEvaluator('groundedness'));

const suite = {
  name: 'skill:search',
  layer: 'skill' as const,
  tests: [],
  defaults: { timeout: 60_000, repetitions: 2 },
  adapter: ['mcp', 'plain-llm'],
  skillDir: './skills/search-skill',
};

const results = await runSkillSuite(suite, pluginConfig, suite.defaults, evaluatorRegistry);

for (const r of results) {
  console.log(`${r.pass ? '✅' : '❌'} ${r.name} [${r.adapter}] — ${r.latencyMs}ms`);
  for (const e of r.evaluatorResults) {
    console.log(`  ${e.evaluator}: ${e.score.toFixed(2)} ${e.pass ? '' : '(FAIL)'}`);
  }
}
```

## See Also

- [Adapters](../adapters.md)
- [Evaluators](../evaluators.md)
- [LLM Eval Layer](./llm.md)
- [Dataset Management](../datasets.md)
