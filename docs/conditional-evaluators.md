# Conditional Evaluators

Skip evaluators that don't apply to the current test context. Reduces noise and saves LLM judge costs.

## Usage

```yaml
evaluators:
  - name: groundedness
    when:
      hasToolCalls: true
  - name: rag
    when:
      toolsInclude: [search, retrieve]
  - name: correctness
    when:
      adapter: [mcp, cursor-cli]
      minToolCalls: 1
```

## Conditions

All conditions use AND logic — every specified field must match.

| Field | Type | Description |
|-------|------|-------------|
| `hasToolCalls` | boolean | Run only when tool calls are (or aren't) present |
| `toolsInclude` | string[] | At least one of these tools must have been called |
| `adapter` | string or string[] | Adapter name must match |
| `outputContains` | string | Final output must contain this substring |
| `outputMatches` | string | Final output must match this regex |
| `minToolCalls` | number | Minimum number of tool calls required |
| `maxToolCalls` | number | Maximum number of tool calls allowed |

## Examples

Skip LLM judges when there are no tool calls (saves cost):
```yaml
- name: groundedness
  when: { hasToolCalls: true }
```

Only run RAG evaluator when retrieval tools were used:
```yaml
- name: rag
  when: { toolsInclude: [search, vector_search, retrieve] }
```

Limit evaluators by adapter:
```yaml
- name: workflow
  when: { adapter: cursor-cli }
```
