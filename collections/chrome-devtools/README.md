# Chrome DevTools MCP Server Collection

Integration tests for `@anthropics/chrome-devtools-mcp`.

Covers: `navigate` with URL and title verification,
`screenshot` for default and full-page captures,
`click` element interaction, `type` text input,
`evaluate` for JavaScript expressions (DOM queries, math),
`get_console_logs`, and error cases for nonexistent selectors
and invalid URLs.
