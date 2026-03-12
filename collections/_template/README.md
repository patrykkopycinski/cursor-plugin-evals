# Community Test Collection Template

## Structure

Each collection is a directory containing:

- `suite.yaml` — The test suite definition (required)
- `README.md` — Documentation for the collection (recommended)

## Suite Format

```yaml
name: my-server-tests
layer: integration

tests:
  - name: descriptive-test-name
    tool: tool_name
    args:
      key: value
    assert:
      - field: content[0].text
        op: exists
      - field: content[0].text
        op: contains
        value: expected-substring
```

## Assertions

| Op | Description |
|----|-------------|
| `eq` | Exact equality |
| `neq` | Not equal |
| `gt`, `gte`, `lt`, `lte` | Numeric comparisons |
| `contains` | String/array contains |
| `not_contains` | String/array does not contain |
| `exists` | Field is present and not null |
| `not_exists` | Field is absent or null |
| `length_gte`, `length_lte` | Array/string length |
| `type` | JavaScript typeof check |
| `matches` | Regex match |

## Usage

Reference a built-in collection in your `plugin-eval.yaml`:

```yaml
suites:
  - collection: filesystem
  - collection: memory
```

Or reference a local path:

```yaml
suites:
  - collection: ./my-custom-collection/
```
