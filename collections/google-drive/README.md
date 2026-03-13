# Google Drive MCP Server Collection

Integration tests for `@modelcontextprotocol/server-google-drive`.

Covers: `search_files` by name, MIME type, and folder scope,
`list_files` with and without pagination limits,
`read_file` with default and explicit MIME export,
and error cases for nonexistent file IDs.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_DRIVE_CREDENTIALS` | Yes | Google Drive service account credentials JSON |
