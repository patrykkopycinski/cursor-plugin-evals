# Slack MCP Server Collection

Integration tests for `@modelcontextprotocol/server-slack`.

Covers: `list_channels` with and without limits, `search_messages` with text
and user filters, `get_channel_history`, `get_thread` for thread replies,
`post_message`, `list_users`, `get_user_profile`, and error cases for
invalid channel IDs.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | Slack Bot User OAuth Token (xoxb-...) |
