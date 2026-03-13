# GitHub MCP Server Collection

Integration tests for `@modelcontextprotocol/server-github`.

Covers: `search_repositories`, `list_repos`, `get_file_contents`, `get_issue`, `list_issues`,
`create_issue`, `search_code`, `list_branches`, `get_pull_request`, `list_commits`,
`create_pull_request`, and error cases for nonexistent issues and files.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Yes | GitHub personal access token |
