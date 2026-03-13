# Unit Layer

Verify that MCP tools register correctly, conform to their schemas, and handle conditional registration.

## Checks

| Check | Description |
|-------|-------------|
| `registration` | Connects to the MCP server, lists tools, and verifies expected tools are present |
| `schema` | Validates that a tool's input schema is well-formed JSON Schema |
| `conditional_registration` | Verifies that tools register/deregister based on environment variables |
| `response_format` | Calls a tool and verifies the response follows MCP content format |

## YAML Config

```yaml
suites:
  - name: unit-basics
    layer: unit
    tests:
      - name: all-tools-register
        check: registration
        expectedTools:
          - elasticsearch_api
          - esql_query
          - kibana_api

      - name: search-schema
        check: schema
        tool: elasticsearch_api

      - name: conditional-apm
        check: conditional_registration
        tool: setup_apm
        env:
          ENABLE_APM: "true"
        minimalEnv:
          ENABLE_APM: "false"

      - name: response-shape
        check: response_format
        tool: elasticsearch_api
        args:
          method: GET
          path: /_cat/health
```

## How It Works

### registration

Connects to the MCP server, calls `listTools()`, and checks that every tool in `expectedTools` appears in the result. If `expectedTools` is omitted, the test simply verifies that at least one tool registers.

### schema

Fetches the tool's `inputSchema` and validates it as well-formed JSON Schema — checks for valid `type` values, correct `required` arrays, and valid nested `properties`.

### conditional_registration

Runs the server twice with different environment variables:
1. With `env` — expects the tool to be present
2. With `minimalEnv` — expects the tool to be absent

### response_format

Calls the tool with the given `args` and verifies the response has the MCP content structure (`content` array with `type` and `text`/`blob` fields).

## CLI Usage

```bash
# Run only unit tests
cursor-plugin-evals run -l unit
```

## Programmatic API

```typescript
import { McpPluginClient } from 'cursor-plugin-evals';

const client = await McpPluginClient.connect({
  command: 'node',
  args: ['dist/index.js'],
});

const tools = await client.listTools();
console.log(`Registered tools: ${tools.map(t => t.name).join(', ')}`);

for (const tool of tools) {
  const schema = tool.inputSchema;
  console.log(`${tool.name}: ${Object.keys(schema.properties ?? {}).length} params`);
}

await client.disconnect();
```

## See Also

- [Static Layer](./static.md)
- [Integration Layer](./integration.md)
- [Configuration Reference](../configuration.md)
