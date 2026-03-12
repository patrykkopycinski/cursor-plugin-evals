## ADDED Requirements

### Requirement: Registration checker verifies expected tool count

The unit testing layer MUST provide a registration checker that spawns the MCP
server, calls `tools/list`, and verifies that the total number of registered tools
matches the expected count declared in the test configuration.

#### Scenario: Tool count matches

- **WHEN** the test expects 34 tools and the MCP server registers 34 tools
- **THEN** the check MUST pass with a result indicating the expected and actual
  counts match

#### Scenario: Tool count mismatch — fewer than expected

- **WHEN** the test expects 34 tools and the MCP server registers 30 tools
- **THEN** the check MUST fail with a result listing the expected count (34),
  actual count (30), and the 4 missing tool names

#### Scenario: Tool count mismatch — more than expected

- **WHEN** the test expects 34 tools and the MCP server registers 36 tools
- **THEN** the check MUST fail with a result listing the expected count (34),
  actual count (36), and the 2 unexpected tool names

---

### Requirement: Registration checker verifies expected tool names

The registration checker MUST accept an array of expected tool names and verify
that every expected name is present in the `tools/list` response. The checker
MUST also detect any tool names returned by the server that are NOT in the
expected list.

#### Scenario: All expected tools are registered

- **WHEN** the expected list is `["elasticsearch_api", "esql_query", "kibana_api"]`
  and all three are returned by `tools/list`
- **THEN** the check MUST pass with all three tools confirmed present

#### Scenario: Missing expected tool

- **WHEN** the expected list includes `"create_dashboard"` but it is not in the
  `tools/list` response
- **THEN** the check MUST fail and the result MUST identify `"create_dashboard"`
  as missing

#### Scenario: Unexpected tool registered

- **WHEN** the server registers `"debug_internal"` which is not in the expected
  list
- **THEN** the check MUST fail and the result MUST identify `"debug_internal"` as
  unexpected

#### Scenario: Both missing and unexpected tools

- **WHEN** `"tool_a"` is expected but missing, and `"tool_x"` is registered but
  not expected
- **THEN** the result MUST list `"tool_a"` as missing and `"tool_x"` as
  unexpected

---

### Requirement: Schema validation produces valid JSON Schema from Zod inputSchema

For each registered tool, the unit testing layer MUST validate that the tool's
`inputSchema` (as returned by `tools/list`) is a valid JSON Schema object. The
validator MUST check that the schema has `type: "object"` at the root and that
`properties` is a well-formed object.

#### Scenario: Valid JSON Schema

- **WHEN** a tool's `inputSchema` is
  `{ type: "object", properties: { path: { type: "string" } }, required: ["path"] }`
- **THEN** the validation MUST pass

#### Scenario: Missing type field

- **WHEN** a tool's `inputSchema` is `{ properties: { path: { type: "string" } } }`
  with no root `type` field
- **THEN** the validation MUST fail indicating the root `type` is missing

#### Scenario: Invalid property type

- **WHEN** a tool's `inputSchema` has a property with `type: "unknown_type"`
- **THEN** the validation MUST fail identifying the property and the invalid type

---

### Requirement: Schema validation checks required fields

The schema validator MUST verify that fields marked as required in the Zod schema
appear in the JSON Schema's `required` array. Conversely, optional Zod fields
MUST NOT appear in `required`.

#### Scenario: Required field correctly marked

- **WHEN** a tool's Zod schema has `method` as a required string and the JSON
  Schema has `required: ["method"]`
- **THEN** the check MUST pass for the `method` field

#### Scenario: Required field missing from required array

- **WHEN** a tool's Zod schema has `method` as required but the JSON Schema's
  `required` array does not include `"method"`
- **THEN** the check MUST fail identifying `"method"` as expected-required but
  not marked required

#### Scenario: Optional field incorrectly in required array

- **WHEN** a tool's Zod schema has `body` as optional but the JSON Schema's
  `required` array includes `"body"`
- **THEN** the check MUST fail identifying `"body"` as optional but incorrectly
  marked required

---

### Requirement: Schema validation checks enum values

The schema validator MUST verify that string properties with Zod `.enum()` or
`.literal()` constraints produce JSON Schema `enum` arrays with the correct
values.

#### Scenario: Enum values match

- **WHEN** a Zod schema defines `method: z.enum(["GET", "POST", "PUT", "DELETE"])`
  and the JSON Schema has `method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] }`
- **THEN** the check MUST pass

#### Scenario: Enum values mismatch

- **WHEN** the Zod schema defines `method: z.enum(["GET", "POST"])` but the JSON
  Schema has `enum: ["GET", "POST", "PUT"]`
- **THEN** the check MUST fail listing the expected and actual enum values

#### Scenario: Missing enum constraint

- **WHEN** the Zod schema defines an enum but the JSON Schema property has no
  `enum` field
- **THEN** the check MUST fail indicating the enum constraint was lost during
  schema generation

---

### Requirement: Conditional registration without cluster credentials

The unit testing layer MUST support a conditional registration check that spawns
the MCP server with a minimal environment (no `ES_URL`, no `ES_API_KEY`, no
`ES_CLOUD_ID`) and verifies that gateway tools requiring cluster connectivity are
NOT registered. This confirms that the plugin gracefully degrades when no cluster
is available.

#### Scenario: Gateway tools absent without credentials

- **WHEN** the MCP server is spawned without `ES_URL`, `ES_API_KEY`, or
  `ES_CLOUD_ID` in the environment
- **THEN** tools that require Elasticsearch connectivity (e.g.,
  `elasticsearch_api`, `esql_query`, `kibana_api`) MUST NOT appear in the
  `tools/list` response

#### Scenario: Non-gateway tools still registered

- **WHEN** the MCP server is spawned without cluster credentials
- **THEN** tools that do not require cluster connectivity (e.g.,
  `get_deployment_guide`, `get_connection_config`) MUST still appear in the
  `tools/list` response

---

### Requirement: Conditional registration with cluster credentials

The unit testing layer MUST verify that when the MCP server is spawned with valid
cluster credentials (`ES_URL` at minimum), all gateway tools ARE registered.

#### Scenario: Gateway tools present with credentials

- **WHEN** the MCP server is spawned with `ES_URL=http://localhost:9200` in the
  environment
- **THEN** gateway tools (`elasticsearch_api`, `esql_query`, `kibana_api`) MUST
  appear in the `tools/list` response

#### Scenario: Full credential set

- **WHEN** the MCP server is spawned with `ES_URL`, `ES_API_KEY`, and
  `KIBANA_URL` set
- **THEN** all gateway tools and Kibana-specific tools MUST be registered

---

### Requirement: Response format validation

The unit testing layer MUST verify that tool handlers produce responses using the
standard response helper functions (`textResponse`, `errorResponse`,
`jsonResponse`) rather than raw MCP content arrays. This MAY be implemented via
static analysis of the tool source code or via runtime inspection of tool call
results.

#### Scenario: Static analysis — correct helper usage

- **WHEN** a tool handler source file returns `textResponse("result")`
- **THEN** the response format check MUST pass for that tool

#### Scenario: Static analysis — raw content array

- **WHEN** a tool handler source file returns
  `{ content: [{ type: "text", text: "result" }] }` directly instead of using a
  helper
- **THEN** the response format check MUST fail identifying the tool and the
  non-standard return pattern

#### Scenario: Runtime check — well-formed response

- **WHEN** a tool is called and returns a result with `content` as an array of
  objects each having `type` and `text` fields
- **THEN** the runtime format check MUST pass

#### Scenario: Runtime check — malformed response

- **WHEN** a tool is called and returns a result where `content` is a plain
  string instead of an array of content objects
- **THEN** the runtime format check MUST fail with a description of the expected
  format

---

### Requirement: Results reporting per check

Every unit test check MUST produce a structured result object containing:
- `check` (string): The name of the check
- `tool` (string, optional): The tool name if the check is tool-specific
- `passed` (boolean): Whether the check passed
- `details` (string): Human-readable explanation of the result
- `expected` (any, optional): The expected value for comparison checks
- `actual` (any, optional): The actual value observed

#### Scenario: Passing check result

- **WHEN** the registration count check passes with 34 expected and 34 actual
- **THEN** the result MUST have `passed: true`, `check: "registration-count"`,
  `expected: 34`, `actual: 34`, and a details string confirming the match

#### Scenario: Failing check result

- **WHEN** the schema required-field check fails for tool `"elasticsearch_api"`
  field `"method"`
- **THEN** the result MUST have `passed: false`,
  `check: "schema-required-fields"`, `tool: "elasticsearch_api"`, and details
  explaining that `"method"` was expected to be required

#### Scenario: Aggregate results for a suite

- **WHEN** a unit test suite runs 20 checks and 18 pass
- **THEN** the suite result MUST contain all 20 individual check results and a
  summary with `total: 20`, `passed: 18`, `failed: 2`
