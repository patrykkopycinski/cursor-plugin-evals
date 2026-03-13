# Integration Layer

Test individual MCP tool calls against a live server with assertions, workflow chains, and error handling.

## Tool Call Testing

Each integration test calls a specific tool with given arguments and optionally asserts on the response.

```yaml
suites:
  - name: integration-tests
    layer: integration
    require_env: [ES_URL]
    tests:
      - name: cat-health
        tool: elasticsearch_api
        args:
          method: GET
          path: /_cat/health
        assert:
          - field: content[0].text
            op: contains
            value: "green"
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
      - name: index-exists
        tool: elasticsearch_api
        args:
          method: GET
          path: /my-index/_count
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
        tool: elasticsearch_api
        args:
          method: PUT
          path: /test-index
        workflow:
          - tool: elasticsearch_api
            args:
              method: POST
              path: /test-index/_doc
              body: '{"title": "hello"}'
            output: docId
          - tool: elasticsearch_api
            args:
              method: GET
              path: /test-index/_doc/$docId
            assert:
              - field: content[0].text
                op: contains
                value: "hello"
          - tool: elasticsearch_api
            args:
              method: DELETE
              path: /test-index
```

Each workflow step runs sequentially. If any step fails its assertions, the test fails.

## Error Handling Tests

Test that tools return proper errors for invalid input:

```yaml
      - name: invalid-method
        tool: elasticsearch_api
        args:
          method: INVALID
          path: /test
        expectError: true
```

With `expectError: true`, the test passes when the tool returns `isError: true` in its result.

## Setup and Teardown

Run shell commands before and after a suite:

```yaml
suites:
  - name: integration-with-setup
    layer: integration
    setup: "curl -X PUT http://localhost:9200/test-index"
    teardown: "curl -X DELETE http://localhost:9200/test-index"
    tests:
      - name: query-test-index
        tool: elasticsearch_api
        args:
          method: GET
          path: /test-index/_search
```

## Conditional Gating

Skip suites when required environment variables are missing:

```yaml
suites:
  - name: es-integration
    layer: integration
    require_env: [ES_URL, ES_API_KEY]
    tests:
      - name: cluster-health
        tool: elasticsearch_api
        args: { method: GET, path: /_cluster/health }
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
cursor-plugin-evals run -l integration -s es-integration

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
