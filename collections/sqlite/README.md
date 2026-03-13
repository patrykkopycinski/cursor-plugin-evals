# SQLite MCP Server Collection

Integration tests for `@modelcontextprotocol/server-sqlite`.

Covers: `list_tables`, `describe_table`, `write_query` for DDL/DML
(CREATE TABLE, INSERT, DROP TABLE), `read_query` for SELECT with WHERE,
ORDER BY, COUNT, and error cases for invalid SQL syntax.
