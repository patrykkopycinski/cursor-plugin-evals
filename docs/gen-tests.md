# Test Auto-Generation

Automatically generate integration test cases from MCP tool JSON schemas. The schema walker produces three categories of tests without any manual authoring.

## CLI Usage

```bash
# Generate tests for all tools
cursor-plugin-evals gen-tests -o generated-tests.yaml

# Generate tests for a single tool
cursor-plugin-evals gen-tests --tool search_tool -o search-tests.yaml

# Use a custom config
cursor-plugin-evals gen-tests -c ./plugin-eval.yaml --tool search -o search-tests.yaml
```

The command connects to your MCP server, discovers tool schemas, and writes a YAML suite file.

## Three Test Categories

### Valid

- **all-fields**: Calls the tool with every property populated with schema-appropriate values.
- **required-only**: Calls with only required fields (when optional fields exist).
- **enum-variants**: One test per enum value for each enum-typed property.

### Boundary

- **min/max strings**: Empty string, `minLength`, `maxLength` boundary values.
- **min/max numbers**: Exact `minimum`/`maximum` values, zero.
- **empty arrays**: `minItems=0` arrays, `maxItems`-length arrays.

### Negative

- **missing-required**: Omits each required field one at a time.
- **wrong-type**: Passes a string where a number is expected (and vice versa).
- **null-required**: Sets each required field to `null`.

## Schema Walker Behavior

The walker traverses `properties` recursively:

1. Reads `type`, `enum`, `default`, `const`, `format`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`.
2. Generates values using heuristics (e.g., `format: email` → `user@example.com`).
3. For nested `object` types, recursively generates valid sub-objects.
4. For `array` types with `items`, generates single-element arrays of the item type.

## Programmatic API

```typescript
import { McpPluginClient } from 'cursor-plugin-evals';
import { generateTestsFromSchema, formatAsYaml } from 'cursor-plugin-evals';

const client = await McpPluginClient.connect({ command: 'node', args: ['dist/index.js'] });
const tools = await client.listTools();

const tests = tools.flatMap((tool) =>
  generateTestsFromSchema(tool.name, tool.inputSchema as Record<string, unknown>),
);

// Each test has: { name, tool, args, category, description }
console.log(`Generated ${tests.length} tests`);
console.log(formatAsYaml(tests, 'my-plugin'));

await client.disconnect();
```
