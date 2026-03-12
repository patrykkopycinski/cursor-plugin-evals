## ADDED Requirements

### Requirement: Convert MCP tool definitions to OpenAI function-calling format

The schema converter MUST accept the MCP `tools/list` response (an array of tool
objects with `name`, `description`, and `inputSchema` in JSON Schema format) and
return a `Record<string, ToolDefinition>` compatible with the OpenAI chat
completions API function-calling interface. Each entry MUST be keyed by tool name
and contain `type: "function"`, `function.name`, `function.description`, and
`function.parameters`.

#### Scenario: Convert a single tool

- **WHEN** the converter receives an MCP tool with
  `name: "elasticsearch_api"`, `description: "Execute ES REST API calls"`, and an
  `inputSchema` containing `method` (string enum) and `path` (string) properties
- **THEN** the output MUST contain a key `"elasticsearch_api"` with
  `type: "function"`, `function.name: "elasticsearch_api"`,
  `function.description: "Execute ES REST API calls"`, and
  `function.parameters` matching the input JSON Schema

#### Scenario: Convert multiple tools

- **WHEN** the converter receives 5 MCP tools
- **THEN** the output MUST contain exactly 5 entries, one per tool, each keyed
  by its tool name

---

### Requirement: Preserve JSON Schema property types

The converter MUST faithfully translate all JSON Schema property types from the
MCP `inputSchema` into the output `function.parameters` object. Supported types
MUST include `string`, `number`, `integer`, `boolean`, `array`, `object`, and
`null`.

#### Scenario: String and number properties

- **WHEN** the input schema has `{ method: { type: "string" }, timeout: { type: "number" } }`
- **THEN** the output parameters MUST preserve both types exactly

#### Scenario: Boolean property

- **WHEN** the input schema has `{ dryRun: { type: "boolean" } }`
- **THEN** the output parameters MUST contain `dryRun` with `type: "boolean"`

---

### Requirement: Handle nested object schemas

The converter MUST correctly translate nested `object` type properties including
their sub-properties, required fields, and additional property constraints. Nested
objects MUST be recursively converted.

#### Scenario: Single-level nested object

- **WHEN** the input schema has a `body` property of type `object` with
  properties `query` (string) and `size` (integer)
- **THEN** the output MUST contain a `body` parameter of type `object` with both
  nested properties and their types preserved

#### Scenario: Deeply nested objects

- **WHEN** the input schema has `config.settings.advanced.retries` as a 3-level
  nested object chain
- **THEN** the output MUST preserve the full nesting hierarchy with all
  intermediate object types and their properties

---

### Requirement: Handle array schemas

The converter MUST correctly translate `array` type properties including their
`items` schema. Array items MAY be primitive types, objects, or other arrays.

#### Scenario: Array of strings

- **WHEN** the input schema has `{ tags: { type: "array", items: { type: "string" } } }`
- **THEN** the output MUST contain `tags` with `type: "array"` and
  `items: { type: "string" }`

#### Scenario: Array of objects

- **WHEN** the input schema has an array property whose items are objects with
  `name` and `value` properties
- **THEN** the output MUST preserve the array type with the full object items
  schema including both properties

---

### Requirement: Handle enum values

The converter MUST preserve `enum` constraints on string properties. The enum
values MUST be included in the output parameters exactly as specified in the
input schema.

#### Scenario: String enum

- **WHEN** the input schema has
  `{ method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] } }`
- **THEN** the output MUST contain `method` with the same enum array

#### Scenario: Enum with description

- **WHEN** the input schema has a property with both `enum` and `description`
  fields
- **THEN** the output MUST preserve both the enum values and the description text

---

### Requirement: Handle discriminated unions

The converter MUST support JSON Schema discriminated unions expressed via `oneOf`
or `anyOf` with a discriminator property. The union variants MUST be preserved in
the output parameters.

#### Scenario: oneOf with discriminator

- **WHEN** the input schema uses `oneOf` with three variants discriminated by an
  `operation` property
- **THEN** the output MUST contain the `oneOf` array with all three variants and
  their respective property schemas

#### Scenario: anyOf with shared properties

- **WHEN** the input schema uses `anyOf` with two variants sharing a `type`
  discriminator
- **THEN** the output MUST preserve the `anyOf` structure with both variants

---

### Requirement: Preserve required field markers

The converter MUST preserve the `required` array from the input schema at every
level of nesting. Properties listed in `required` MUST remain required in the
output. Optional properties (not in `required`) MUST NOT be added to the
`required` array.

#### Scenario: Top-level required fields

- **WHEN** the input schema has `required: ["method", "path"]` and an optional
  `body` property
- **THEN** the output parameters MUST have `required: ["method", "path"]` and
  `body` MUST NOT appear in the required array

#### Scenario: Nested required fields

- **WHEN** a nested object property has its own `required` array
- **THEN** the output MUST preserve the nested `required` array independently of
  the top-level required array

---

### Requirement: Preserve description text for parameters

The converter MUST preserve `description` fields on every property at every level
of nesting. These descriptions are critical for LLM parameter understanding.

#### Scenario: Top-level parameter descriptions

- **WHEN** the input schema has `method` with
  `description: "HTTP method to use"`
- **THEN** the output MUST contain the same description on the `method` parameter

#### Scenario: Nested parameter descriptions

- **WHEN** a nested object property has descriptions on its sub-properties
- **THEN** all nested descriptions MUST be preserved in the output

---

### Requirement: Tool allowlist filtering

The converter MUST support an optional `allowlist` parameter — an array of tool
names. When provided, only tools whose names appear in the allowlist SHALL be
included in the output. When the allowlist is `undefined` or empty, all tools
MUST be included.

#### Scenario: Filter to specific tools

- **WHEN** the converter receives 10 MCP tools and an allowlist of
  `["elasticsearch_api", "esql_query"]`
- **THEN** the output MUST contain exactly 2 entries for the specified tools

#### Scenario: No allowlist

- **WHEN** the converter receives 10 MCP tools and no allowlist is provided
- **THEN** the output MUST contain all 10 tools

#### Scenario: Allowlist with unknown tool name

- **WHEN** the allowlist contains `"nonexistent_tool"` which is not in the MCP
  tool list
- **THEN** the output MUST NOT contain an entry for `"nonexistent_tool"` and MUST
  NOT throw an error

---

### Requirement: Empty input handling

The converter MUST handle edge cases where the MCP tool list is empty or a tool
has an empty input schema.

#### Scenario: Empty tool list

- **WHEN** the converter receives an empty array of MCP tools
- **THEN** the output MUST be an empty `Record` (`{}`)

#### Scenario: Tool with no parameters

- **WHEN** an MCP tool has `inputSchema: { type: "object", properties: {} }` (no
  parameters)
- **THEN** the output MUST contain the tool with an empty `parameters.properties`
  object
