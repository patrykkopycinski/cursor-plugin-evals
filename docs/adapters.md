# Task Adapters

Adapters define how test prompts are executed. Each adapter wraps a different execution backend, allowing the same test suite to be evaluated across multiple environments.

## What Adapters Do

An adapter takes an `Example` (with `input.prompt` and optional metadata) and returns a `TaskOutput` containing:
- `messages` — the conversation history
- `toolCalls` — all tool calls made during execution
- `output` — the final text response
- `latencyMs` — total execution time
- `tokenUsage` — input/output token counts
- `adapter` — the adapter name (for reporting)

## Available Adapters

### mcp

The default adapter. Runs a full agent loop using the MCP plugin server with tool calling.

- Connects to the MCP server defined in `plugin-eval.yaml`
- Tools are discovered via `listTools()`
- The LLM calls tools through the MCP protocol
- Supports all MCP transports (stdio, HTTP, SSE, streamable-http)

```yaml
suites:
  - name: mcp-tests
    layer: skill
    adapter: mcp
```

### plain-llm

Sends the prompt directly to an LLM without any tool calling. Useful for testing response quality in isolation.

- No MCP connection needed
- No tool calls in the output
- Useful as a baseline for comparison

```yaml
    adapter: plain-llm
```

### headless-coder

Runs the prompt through a headless coding agent that can read/write files and execute commands.

- Operates in a sandboxed working directory
- Tracks `filesModified` in the output
- Useful for testing code generation skills

```yaml
    adapter: headless-coder
```

### gemini-cli

Executes prompts through the Gemini CLI interface.

- Requires the Gemini CLI to be installed
- Supports tool calling via Gemini's function calling API

```yaml
    adapter: gemini-cli
```

### claude-sdk

Executes prompts through the Claude SDK with tool use support.

- Uses the Anthropic SDK directly
- Supports Claude's native tool use format

```yaml
    adapter: claude-sdk
```

## Configuring Per-Suite

Specify one or more adapters at the suite level:

```yaml
suites:
  - name: cross-adapter-eval
    layer: skill
    adapter:
      - mcp
      - plain-llm
      - headless-coder
    tests:
      - name: search-test
        prompt: "Find error logs"
```

Each test runs once per adapter. Results are tagged with the adapter name.

## Adapter Configuration

Adapters receive configuration from the suite and plugin config:

```typescript
interface AdapterConfig {
  name: string;          // adapter name
  model?: string;        // LLM model to use
  timeout?: number;      // max execution time
  apiBaseUrl?: string;   // custom API endpoint
  apiKey?: string;       // API key override
  workingDir?: string;   // working directory (headless-coder)
  skillPath?: string;    // path to SKILL.md
  toolCatalog?: Record<string, string>; // tool name → description mapping
}
```

## Creating Custom Adapters

Implement the `TaskAdapter` interface:

```typescript
import type { TaskAdapter, Example, TaskOutput } from 'cursor-plugin-evals';

const myAdapter: TaskAdapter = async (example) => {
  const startTime = Date.now();

  // Execute the prompt through your custom backend
  const response = await myBackend.run(example.input.prompt);

  return {
    messages: [
      { role: 'user', content: example.input.prompt },
      { role: 'assistant', content: response.text },
    ],
    toolCalls: response.toolCalls ?? [],
    output: response.text,
    latencyMs: Date.now() - startTime,
    tokenUsage: response.usage ?? null,
    adapter: 'my-custom-adapter',
  };
};
```

## Programmatic API

```typescript
import { createAdapter } from 'cursor-plugin-evals';
import type { AdapterConfig } from 'cursor-plugin-evals';

const config: AdapterConfig = {
  name: 'mcp',
  model: 'gpt-4o',
  timeout: 30000,
};

const adapter = createAdapter('mcp', config);
const output = await adapter({
  input: { prompt: 'List all tools' },
});

console.log(`Adapter: ${output.adapter}`);
console.log(`Tools called: ${output.toolCalls.map(t => t.tool).join(', ')}`);
console.log(`Output: ${output.output.slice(0, 200)}`);
```

## See Also

- [Skill Eval Layer](./layers/skill.md)
- [LLM Eval Layer](./layers/llm.md)
- [Configuration Reference](./configuration.md)
