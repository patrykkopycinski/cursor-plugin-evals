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

### otel-trace

Evaluates from recorded OTel traces without re-executing the agent. Reads traces from JSON files or Elasticsearch/EDOT.

- No agent execution — scores existing traces
- Supports Jaeger JSON and OTLP JSON formats
- Queries Elasticsearch with APM and OTLP-native index patterns
- Works with EDOT collector traces

```yaml
suites:
  - name: trace-replay
    adapter: otel-trace
    adapter_config:
      traceSource:
        type: file
        path: ./traces/*.json
        format: auto
    tests:
      - name: check-tool-use
        input: { traceId: "abc123" }
        expected: { tools: [search_tool] }
```

#### Elasticsearch / EDOT source

```yaml
adapter_config:
  traceSource:
    type: elasticsearch
    endpoint: https://my-cluster.es.io
    apiKey: ${ES_API_KEY}
    index: traces-apm*,traces-generic.otel-*
    serviceName: my-agent
    timeRange: { from: "now-1h", to: "now" }
    docFormat: auto  # 'apm', 'otlp', or 'auto'
```

### claude-cli

Runs prompts through the Claude Code CLI.

- Spawns `claude -p --output-format json`
- Supports tool calls via Claude's native tool use
- Parses JSON output for messages and tool calls

```yaml
suites:
  - name: claude-tests
    adapter: claude-cli
```

## Adapter Capabilities

Each adapter declares its capabilities, which evaluators use to auto-skip inapplicable checks:

| Adapter | Tool Calls | File Access | Workspace Isolation | Reports Input Tokens |
|---------|-----------|-------------|---------------------|---------------------|
| **mcp** | Yes | No | No | Yes |
| **plain-llm** | No | No | No | Yes |
| **cursor-cli** | Yes | Yes | Yes | No (estimated) |
| **headless-coder** | Yes | Yes | No | Yes |
| **gemini-cli** | Yes | No | No | Yes |
| **claude-sdk** | Yes | No | No | Yes |
| **otel-trace** | Yes (replayed) | No | No | No (from trace) |
| **claude-cli** | Yes | Yes | No | No (estimated) |

When an evaluator like `groundedness` runs against `plain-llm` (no tool calls), it automatically
returns `skipped: true` instead of scoring 0 — this prevents false negatives from dragging down
aggregate scores.

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
  retry?: {              // configurable retry for transient failures
    maxRetries?: number;   // default: 3
    baseDelayMs?: number;  // default: 2000
    retryPattern?: string; // regex pattern for retryable errors (default: cli-config race)
  };
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
  model: 'gpt-5.4',
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
