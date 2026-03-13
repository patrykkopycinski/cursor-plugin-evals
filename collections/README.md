# Community Test Collections

Pre-built integration test suites for popular MCP servers. Each collection provides ready-to-run tests that validate tool behavior, response structure, and error handling.

## Quick Start

Reference a collection in your `plugin-eval.yaml`:

```yaml
suites:
  - collection: filesystem
  - collection: memory
  - collection: fetch
```

Or reference a local/custom collection:

```yaml
suites:
  - collection: ./my-custom-collection/
```

## Available Collections

| Collection | Server Package | Tests | Env Required |
|---|---|---|---|
| [filesystem](./filesystem/) | `@modelcontextprotocol/server-filesystem` | 12 | — |
| [memory](./memory/) | `@modelcontextprotocol/server-memory` | 10 | — |
| [github](./github/) | `@modelcontextprotocol/server-github` | 14 | `GITHUB_TOKEN` |
| [brave-search](./brave-search/) | `@modelcontextprotocol/server-brave-search` | 10 | `BRAVE_API_KEY` |
| [fetch](./fetch/) | `@modelcontextprotocol/server-fetch` | 10 | — |
| [postgres](./postgres/) | `@modelcontextprotocol/server-postgres` | 12 | `DATABASE_URL` |
| [sqlite](./sqlite/) | `@modelcontextprotocol/server-sqlite` | 10 | — |
| [slack](./slack/) | `@modelcontextprotocol/server-slack` | 10 | `SLACK_BOT_TOKEN` |
| [time](./time/) | `@modelcontextprotocol/server-time` | 8 | — |
| [everything](./everything/) | `@modelcontextprotocol/server-everything` | 10 | — |
| [puppeteer](./puppeteer/) | `@modelcontextprotocol/server-puppeteer` | 10 | — |
| [sequential-thinking](./sequential-thinking/) | `@modelcontextprotocol/server-sequential-thinking` | 8 | — |
| [notion](./notion/) | `@modelcontextprotocol/server-notion` | 10 | `NOTION_API_KEY` |
| [google-drive](./google-drive/) | `@modelcontextprotocol/server-google-drive` | 8 | `GOOGLE_DRIVE_CREDENTIALS` |
| [chrome-devtools](./chrome-devtools/) | `@anthropics/chrome-devtools-mcp` | 12 | — |

**Total: 154 tests across 15 collections**

## Environment Variables

Some collections require environment variables for authentication. Set them before running:

```bash
# GitHub
export GITHUB_TOKEN="ghp_..."

# Brave Search
export BRAVE_API_KEY="BSA..."

# PostgreSQL
export DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"

# Slack
export SLACK_BOT_TOKEN="xoxb-..."

# Notion
export NOTION_API_KEY="ntn_..."

# Google Drive
export GOOGLE_DRIVE_CREDENTIALS='{"type":"service_account",...}'
```

Collections that require missing env vars will be skipped automatically via `require_env`.

## Collection Structure

Each collection is a directory containing:

- `suite.yaml` — Test suite definition (required)
- `README.md` — Documentation (recommended)

## Suite Format

```yaml
name: server-name
layer: integration
require_env:          # optional
  - API_KEY

tests:
  - name: descriptive-test-name
    tool: tool_name
    args:
      key: value
    assert:
      - field: content[0].text
        op: contains
        value: expected-substring

  - name: error-case
    tool: tool_name
    args:
      bad_param: invalid
    expect_error: true
```

## Assertions

| Op | Description |
|---|---|
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
| `one_of` | Value is one of a set |
| `starts_with`, `ends_with` | String prefix/suffix |

## Contributing

1. Copy `_template/` to a new directory named after your MCP server
2. Edit `suite.yaml` with your test cases
3. Add a `README.md` documenting tools covered and required env vars
4. Run your tests to verify they parse and execute correctly
5. Submit a PR — the registry is updated automatically from suite files
