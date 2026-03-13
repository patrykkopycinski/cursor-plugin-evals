# PostgreSQL MCP Server Collection

Integration tests for `@modelcontextprotocol/server-postgres`.

Covers: `query` for SELECT operations (literal values, timestamps, version),
`execute` for DDL/DML (CREATE TABLE, INSERT, UPDATE, DELETE, DROP TABLE),
and error cases for invalid SQL syntax and nonexistent tables.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/db`) |
