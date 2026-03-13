# Multi-Turn Conversation Testing

Test multi-turn agent conversations where context carries across turns and each turn can have its own assertions.

## YAML Config

```yaml
suites:
  - name: conversation-tests
    layer: llm
    tests:
      - name: multi-step-workflow
        type: conversation
        prompt: "Find all indices in my cluster"
        system: "You are an Elasticsearch assistant"
        expected:
          tools: [elasticsearch_api]
        evaluators: [tool-selection, conversation-coherence]
        max_turns: 15
        turns:
          - prompt: "Now show me the mapping for the largest index"
            expected:
              tools: [elasticsearch_api]
              response_contains: ["mapping"]
            evaluators: [tool-selection, response-quality]
          - prompt: "Delete that index"
            expected:
              tools: [elasticsearch_api]
            evaluators: [conversation-coherence]
```

Each entry in `turns` is a `ConversationTurn` with its own `prompt`, optional `system` override, `expected` assertions, and `evaluators`. The initial `prompt` at the top level is turn 0.

## How It Works

1. Turn 0 runs the agent loop with the initial `prompt`/`system`.
2. The full message history (user + assistant) is forwarded to subsequent turns.
3. Each turn runs its evaluators independently against that turn's tool calls and output.
4. The test passes only if **all turns** pass their evaluators.

## Evaluators

The `conversation-coherence` evaluator is an LLM judge that scores three axes (0–1 each):

| Axis | Description |
|------|-------------|
| `turn_relevance` | Does each response address the current request? |
| `consistency` | Are there contradictions across turns? |
| `goal_progression` | Does the conversation make progress? |

The final score is the average. Default threshold: `0.7`.

## Programmatic API

```typescript
import { runConversationTest } from 'cursor-plugin-evals';
import type { LlmTestConfig, PluginConfig, DefaultsConfig, Evaluator } from 'cursor-plugin-evals';

const test: LlmTestConfig = {
  name: 'multi-turn-demo',
  type: 'conversation',
  prompt: 'List all tools',
  expected: { tools: [] },
  evaluators: ['conversation-coherence'],
  turns: [
    { prompt: 'Explain the first tool', evaluators: ['response-quality'] },
  ],
};

const result = await runConversationTest(
  test, 'my-suite', pluginConfig, tools, mcpClient, defaults, 'gpt-4o', evaluatorRegistry,
);

console.log(result.metadata); // { type: 'conversation', turnCount: 2, turns: [...] }
```

Metadata includes per-turn pass/fail, tool call counts, and evaluator results.
