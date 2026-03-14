# Integration Layer

Test individual MCP tool calls against a live server with assertions, workflow chains, and error handling.

## Tool Call Testing

Each integration test calls a specific tool with given arguments and optionally asserts on the response.

```yaml
suites:
  - name: integration-tests
    layer: integration
    require_env: [MY_SERVICE_URL]
    tests:
      - name: health-check
        tool: search_tool
        args:
          query: "health check"
        assert:
          - field: content[0].text
            op: contains
            value: "ok"
```

## Assertions

Assertions use `field`, `op`, and `value` to check tool call results. The `field` supports dot-path traversal and array indexing (e.g. `content[0].text`).

### Available Operators

| Operator | Description | Example Value |
|----------|-------------|---------------|
| `eq` | Strict equality | `"green"` |
| `neq` | Not equal | `"red"` |
| `contains` | String contains substring, or array contains element | `"green"` |
| `not_contains` | String/array does not contain | `"error"` |
| `exists` | Field is defined and not null | — |
| `not_exists` | Field is undefined or null | — |
| `gt` | Greater than (numeric) | `0` |
| `gte` | Greater than or equal | `1` |
| `lt` | Less than | `100` |
| `lte` | Less than or equal | `50` |
| `matches` | Regex match | `"^\\d+\\.\\d+"` |
| `type` | JavaScript typeof check | `"string"` |
| `length_gte` | Array/string length >= value | `1` |
| `length_lte` | Array/string length <= value | `10` |

### Multiple Assertions

```yaml
      - name: item-exists
        tool: search_tool
        args:
          query: "count items"
        assert:
          - field: content[0].text
            op: exists
          - field: isError
            op: neq
            value: true
```

## Workflow Chains

Chain multiple tool calls together with variable binding. Use `output` to capture a value from one step and reference it in the next step's `args` via `$variable` syntax.

```yaml
      - name: create-and-query
        tool: create_record
        args:
          name: "test-item"
        workflow:
          - tool: update_record
            args:
              id: "$recordId"
              title: "hello"
            output: recordId
          - tool: search_tool
            args:
              query: "hello"
            assert:
              - field: content[0].text
                op: contains
                value: "hello"
          - tool: delete_record
            args:
              id: "$recordId"
```

Each workflow step runs sequentially. If any step fails its assertions, the test fails.

## Error Handling Tests

Test that tools return proper errors for invalid input:

```yaml
      - name: invalid-method
        tool: search_tool
        args:
          method: INVALID
          query: ""
        expectError: true
```

With `expectError: true`, the test passes when the tool returns `isError: true` in its result.

## Setup and Teardown

Run shell commands before and after a suite:

```yaml
suites:
  - name: integration-with-setup
    layer: integration
    setup: "curl -X POST http://localhost:3000/setup"
    teardown: "curl -X POST http://localhost:3000/teardown"
    tests:
      - name: query-test-data
        tool: search_tool
        args:
          query: "test data"
```

## Conditional Gating

Skip suites when required environment variables are missing:

```yaml
suites:
  - name: service-integration
    layer: integration
    require_env: [MY_SERVICE_URL, MY_API_KEY]
    tests:
      - name: service-health
        tool: search_tool
        args: { query: "health check" }
```

Individual tests can also use `require_env`:

```yaml
      - name: apm-specific
        require_env: [APM_URL]
        tool: setup_apm
        args: { service_name: test }
```

## CLI Usage

```bash
# Run integration tests only
cursor-plugin-evals run -l integration

# Run a specific suite
cursor-plugin-evals run -l integration -s service-integration

# Use mock fixtures instead of live server
cursor-plugin-evals run -l integration --mock
```

## Programmatic API

```typescript
import { evaluateAssertions } from 'cursor-plugin-evals';
import type { AssertionConfig } from 'cursor-plugin-evals';

const assertions: AssertionConfig[] = [
  { field: 'content[0].text', op: 'contains', value: 'green' },
  { field: 'isError', op: 'eq', value: false },
];

const toolResult = {
  content: [{ type: 'text', text: 'cluster health: green' }],
  isError: false,
};

const results = evaluateAssertions(assertions, toolResult);
for (const r of results) {
  console.log(`${r.field} ${r.op}: ${r.pass ? 'PASS' : 'FAIL'}`);
}
```

## See Also

- [Unit Layer](./unit.md)
- [LLM Eval Layer](./llm.md)
- [Test Auto-Generation](../gen-tests.md)
- [Configuration Reference](../configuration.md)
