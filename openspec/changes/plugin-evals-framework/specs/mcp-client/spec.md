## ADDED Requirements

### Requirement: MCP server process spawning

The MCP client SHALL spawn the plugin's MCP server as a child process using
`StdioClientTransport` from `@modelcontextprotocol/sdk`. The client MUST pass
the configured `command` and `args` to the transport. The client MUST forward all
environment variables specified in the plugin configuration to the child process
environment, merged with the current `process.env`.

#### Scenario: Spawn with default node entry point

- **WHEN** `McpPluginClient.connect()` is called with
  `{ command: "node", args: ["dist/index.js"], env: { ES_URL: "http://localhost:9200" } }`
- **THEN** a child process MUST be spawned running `node dist/index.js` with
  `ES_URL=http://localhost:9200` present in its environment

#### Scenario: Spawn with custom command

- **WHEN** `McpPluginClient.connect()` is called with
  `{ command: "npx", args: ["ts-node", "src/index.ts"] }`
- **THEN** a child process MUST be spawned running `npx ts-node src/index.ts`

#### Scenario: Environment variable merging

- **WHEN** `process.env` contains `HOME=/Users/test` and the config specifies
  `env: { ES_API_KEY: "abc123" }`
- **THEN** the child process environment MUST contain both `HOME=/Users/test`
  and `ES_API_KEY=abc123`

---

### Requirement: Optional pre-build step

The MCP client SHALL support an optional `build_command` configuration field. When
present, the client MUST execute the build command in the plugin directory before
spawning the MCP server process. If the build command exits with a non-zero code,
`connect()` MUST throw an error with the build stderr output.

#### Scenario: Pre-build succeeds

- **WHEN** `connect()` is called with `build_command: "npm run build"` and the
  build exits with code 0
- **THEN** the MCP server process MUST be spawned after the build completes

#### Scenario: Pre-build fails

- **WHEN** `connect()` is called with `build_command: "npm run build"` and the
  build exits with code 1 and stderr `"tsc: error TS2304"`
- **THEN** `connect()` MUST throw an error containing the stderr output and MUST
  NOT spawn the MCP server process

---

### Requirement: MCP initialization handshake

After spawning the child process, the client MUST perform the MCP initialization
handshake by calling `client.connect(transport)`. The client MUST set
`clientInfo` with the name `"cursor-plugin-evals"` and a version string. The
connection MUST complete within a configurable timeout (default 30 seconds). If
the handshake does not complete within the timeout, the client MUST kill the child
process and throw a timeout error.

#### Scenario: Successful handshake

- **WHEN** the MCP server responds to the initialization request within the
  timeout
- **THEN** `connect()` MUST resolve with an `McpPluginClient` instance in a
  connected state

#### Scenario: Handshake timeout

- **WHEN** the MCP server does not respond within 30 seconds (default timeout)
- **THEN** `connect()` MUST reject with a timeout error and the child process
  MUST be terminated

#### Scenario: Custom timeout

- **WHEN** `connect()` is called with `timeout: 5000` and the server does not
  respond within 5 seconds
- **THEN** `connect()` MUST reject with a timeout error after 5 seconds

---

### Requirement: Tool discovery

The client MUST provide a `listTools()` method that sends a `tools/list` request
to the MCP server and returns the full list of available tool definitions. Each
tool definition MUST include `name`, `description`, and `inputSchema` fields as
returned by the server.

#### Scenario: List all tools

- **WHEN** `listTools()` is called on a connected client
- **THEN** the method MUST return an array of tool definitions matching the
  server's `tools/list` response

#### Scenario: Empty tool list

- **WHEN** the MCP server has no tools registered and `listTools()` is called
- **THEN** the method MUST return an empty array

#### Scenario: List tools on disconnected client

- **WHEN** `listTools()` is called after `disconnect()` has been called
- **THEN** the method MUST throw an error indicating the client is not connected

---

### Requirement: Tool execution

The client MUST provide a `callTool(name, args)` method that sends a `tools/call`
request to the MCP server with the specified tool name and arguments. The method
MUST return the full tool result including `content` and `isError` fields. The
client MUST NOT modify or validate the arguments before sending — argument
validation is the server's responsibility.

#### Scenario: Successful tool call

- **WHEN** `callTool("elasticsearch_api", { method: "GET", path: "/_cluster/health" })`
  is called and the server returns a successful result
- **THEN** the method MUST return the result with `isError: false` and the
  response content

#### Scenario: Tool returns error result

- **WHEN** `callTool("elasticsearch_api", { method: "GET", path: "/_bad" })` is
  called and the server returns an error result
- **THEN** the method MUST return the result with `isError: true` and the error
  content, without throwing an exception

#### Scenario: Invalid tool name

- **WHEN** `callTool("nonexistent_tool", {})` is called
- **THEN** the method MUST throw or return an error indicating the tool was not
  found

#### Scenario: Tool execution timeout

- **WHEN** `callTool()` is invoked and the server does not respond within the
  configured per-call timeout
- **THEN** the method MUST reject with a timeout error

---

### Requirement: Resource listing

The client MUST provide a `listResources()` method that sends a `resources/list`
request to the MCP server and returns all available resources. Each resource entry
MUST include `uri`, `name`, and optionally `description` and `mimeType`.

#### Scenario: List available resources

- **WHEN** `listResources()` is called on a connected client with resources
  registered
- **THEN** the method MUST return the array of resource descriptors from the
  server

#### Scenario: No resources available

- **WHEN** the MCP server has no resources and `listResources()` is called
- **THEN** the method MUST return an empty array

---

### Requirement: Resource reading

The client MUST provide a `readResource(uri)` method that sends a
`resources/read` request to the MCP server and returns the resource content. The
method MUST return the content array with `uri`, `text` or `blob`, and
`mimeType` fields.

#### Scenario: Read a text resource

- **WHEN** `readResource("elastic://docs/api/elasticsearch")` is called and the
  server returns text content
- **THEN** the method MUST return the content with the text body and
  `mimeType: "text/markdown"`

#### Scenario: Read non-existent resource

- **WHEN** `readResource("elastic://nonexistent")` is called and the server
  returns an error
- **THEN** the method MUST throw an error indicating the resource was not found

---

### Requirement: Graceful shutdown

The client MUST provide a `disconnect()` method that closes the MCP connection
and terminates the child process. The method MUST first attempt to close the MCP
transport gracefully. If the child process does not exit within 5 seconds after
transport close, the client MUST send SIGKILL. The `disconnect()` method MUST be
idempotent — calling it multiple times MUST NOT throw.

#### Scenario: Clean shutdown

- **WHEN** `disconnect()` is called and the child process exits within 5 seconds
- **THEN** the MCP transport MUST be closed and the child process MUST no longer
  be running

#### Scenario: Forced shutdown on hang

- **WHEN** `disconnect()` is called and the child process does not exit within
  5 seconds
- **THEN** the client MUST send SIGKILL to the child process

#### Scenario: Double disconnect

- **WHEN** `disconnect()` is called twice in succession
- **THEN** the second call MUST resolve without throwing an error

---

### Requirement: Client MUST handle child process crashes

The client MUST detect when the MCP server child process exits unexpectedly (non-zero exit code or signal) and
transition to a disconnected state. Any in-flight `callTool()`,
`listTools()`, `listResources()`, or `readResource()` calls MUST reject with an
error that includes the exit code or signal. Subsequent method calls MUST throw a
"not connected" error.

#### Scenario: Process crashes during tool call

- **WHEN** `callTool()` is in flight and the child process exits with code 1
- **THEN** the pending `callTool()` promise MUST reject with an error containing
  the exit code

#### Scenario: Methods called after crash

- **WHEN** the child process has crashed and `listTools()` is called
- **THEN** the method MUST throw an error indicating the client is not connected

---

### Requirement: Concurrent call safety

The client MUST support multiple concurrent `callTool()` invocations. Each call
MUST be independently tracked and resolve or reject with its own result. The
client MUST NOT serialize concurrent calls unless the underlying transport
requires it.

#### Scenario: Two concurrent tool calls

- **WHEN** `callTool("tool_a", {})` and `callTool("tool_b", {})` are called
  concurrently
- **THEN** both promises MUST resolve independently with their respective results

#### Scenario: One call fails among concurrent calls

- **WHEN** `callTool("tool_a", {})` and `callTool("bad_tool", {})` are called
  concurrently and the second fails
- **THEN** the first call MUST still resolve successfully and the second MUST
  reject with the appropriate error

---

### Requirement: Static factory interface

The `McpPluginClient` class MUST expose a static `connect()` factory method as
the sole way to create connected instances. The constructor MUST NOT be public.
This ensures every `McpPluginClient` instance is fully initialized with a live
MCP connection before any method is called.

#### Scenario: Create client via static factory

- **WHEN** `McpPluginClient.connect(config)` is called with valid config
- **THEN** the method MUST return a connected `McpPluginClient` instance with
  `listTools()`, `callTool()`, `listResources()`, `readResource()`, and
  `disconnect()` available

#### Scenario: Direct construction is prevented

- **WHEN** consumer code attempts to call `new McpPluginClient()`
- **THEN** the constructor MUST NOT be accessible (private or non-exported)
