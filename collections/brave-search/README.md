# Brave Search MCP Server Collection

Integration tests for `@modelcontextprotocol/server-brave-search`.

Covers: `brave_web_search` with basic queries, programming topics, result count,
site-specific search, exact phrase, unicode, result structure validation,
`brave_local_search` for location-based queries, and error cases for empty queries.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BRAVE_API_KEY` | Yes | Brave Search API key |
