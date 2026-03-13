# Notion MCP Server Collection

Integration tests for `@modelcontextprotocol/server-notion`.

Covers: `search` with title queries, empty queries, and object filters,
`get_page`, `create_page`, `update_page`, `get_database`, `query_database`,
`get_block_children`, and error cases for nonexistent pages.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NOTION_API_KEY` | Yes | Notion integration token |
