# Trace Ingestion

Import OpenTelemetry trace JSON exports and auto-generate evaluation test definitions from observed tool calls and LLM prompts.

## CLI Usage

```bash
# Generate integration tests from tool call spans
cursor-plugin-evals trace-import --file trace-export.json -o tests.yaml

# Also generate LLM-layer tests from prompt spans
cursor-plugin-evals trace-import --file trace-export.json --llm -o tests.yaml
```

## OTel JSON Format

The importer expects the standard OTel JSON export format:

```json
{
  "resourceSpans": [{
    "scopeSpans": [{
      "spans": [
        {
          "traceId": "abc123",
          "spanId": "span1",
          "name": "tool-call",
          "attributes": [
            { "key": "tool.name", "value": { "stringValue": "search" } },
            { "key": "tool.args", "value": { "stringValue": "{\"query\":\"test\"}" } }
          ]
        }
      ]
    }]
  }]
}
```

## Span Attribute Extraction

The parser recognizes three attribute namespaces for tool calls:

| Namespace | Attributes |
|-----------|------------|
| `tool.*` | `tool.name`, `tool.args`, `tool.result` |
| `gen_ai.*` | `gen_ai.tool.name`, `gen_ai.tool.args`, `gen_ai.tool.result`, `gen_ai.prompt` |
| `mcp.*` | `mcp.tool.name`, `mcp.tool.args`, `mcp.tool.result` |

Prompt spans are identified by the presence of `gen_ai.prompt` or `user.prompt` attributes (without a tool name). All attribute value types are supported: `stringValue`, `intValue`, `doubleValue`, `boolValue`, `arrayValue`.

## Generated Output

- **Tool spans** → `integration`-layer tests that replay the exact tool call with its arguments.
- **Prompt spans** (with `--llm`) → `llm`-layer tests with the observed prompt and expected tools derived from sibling tool spans.

```yaml
suites:
  - name: trace-abc12345-integration
    layer: integration
    tests:
      - name: trace-search-0
        tool: search
        args: { query: "test" }
  - name: trace-abc12345-llm
    layer: llm
    tests:
      - name: trace-llm-0
        prompt: "Find documents about testing"
        expected:
          tools: [search]
        evaluators: [tool-selection, response-quality]
```

## Programmatic API

```typescript
import { parseOtelTrace, generateTestsFromTrace } from 'cursor-plugin-evals';
import { readFileSync } from 'fs';

const json = JSON.parse(readFileSync('trace.json', 'utf-8'));
const trace = parseOtelTrace(json);

console.log(`Trace ${trace.traceId}: ${trace.spans.length} spans`);

// Access parsed spans directly
for (const span of trace.spans) {
  if (span.toolName) {
    console.log(`Tool: ${span.toolName}, args: ${JSON.stringify(span.toolArgs)}`);
  }
}

const yaml = generateTestsFromTrace(trace, { llm: true });
console.log(yaml);
```
