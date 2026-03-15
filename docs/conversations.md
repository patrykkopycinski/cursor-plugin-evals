# Multi-Turn Conversation Testing

Test multi-turn agent conversations where context carries across turns and each turn can have its own assertions.

## Conversation Preview

Every test that runs through an LLM adapter captures the full conversation transcript in the HTML report. This lets you manually review:

- **System prompts** — the exact instructions given to the model
- **User messages** — what was sent as the user prompt
- **Assistant responses** — the model's full output
- **Tool calls** — inline within assistant messages, with expandable arguments and results
- **Multi-turn flow** — how context carries across turns

### Generating an HTML Report

```bash
npx cursor-plugin-evals run --report html -o report.html
```

Open the HTML file, expand a suite, click a test, then click the **"Conversation (N messages)"** panel to see the full transcript.

<p align="center">
  <img src="screenshots/conversation-preview-top.png" alt="Conversation preview in HTML report" width="90%" />
</p>

<p align="center"><em>Conversation preview — messages color-coded by role with inline tool calls.</em></p>

### JSON Report

The conversation data is also included in the JSON report for programmatic access:

```bash
npx cursor-plugin-evals run --report json -o report.json
```

Each test result includes a `conversation` array:

```json
{
  "name": "test-name",
  "conversation": [
    { "role": "system", "content": "You are..." },
    { "role": "user", "content": "Find error logs" },
    { "role": "assistant", "content": "I found 42 errors..." }
  ]
}
```

## YAML Config

```yaml
suites:
  - name: conversation-tests
    layer: llm
    tests:
      - name: multi-step-workflow
        type: conversation
        prompt: "Find all items in my collection"
        system: "You are a helpful assistant"
        expected:
          tools: [search_tool]
        evaluators: [tool-selection, conversation-coherence]
        max_turns: 15
        turns:
          - prompt: "Now show me the details for the largest item"
            expected:
              tools: [search_tool]
              response_contains: ["details"]
            evaluators: [tool-selection, response-quality]
          - prompt: "Delete that item"
            expected:
              tools: [search_tool]
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
  test, 'my-suite', pluginConfig, tools, mcpClient, defaults, 'gpt-5.4', evaluatorRegistry,
);

console.log(result.metadata); // { type: 'conversation', turnCount: 2, turns: [...] }
console.log(result.conversation); // Full message history: [{ role: 'user', content: '...' }, ...]
```

Metadata includes per-turn pass/fail, tool call counts, and evaluator results. The `conversation` field contains the full message history for manual review.
