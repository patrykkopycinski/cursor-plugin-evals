## ADDED Requirements

### Requirement: Tool executor verifies single tool calls against assertions

The integration test runner SHALL spawn an `McpPluginClient`, call a single tool
with predetermined arguments, and verify the response against a list of
assertions. Each assertion MUST specify a field path (dot-notation, supporting
array indexing), an operator, and an expected value. The executor MUST extract
the field from the tool response content, apply the operator, and produce a
pass/fail result with an explanation on failure.

#### Scenario: Successful assertion with eq operator

- **WHEN** the test calls `elasticsearch_api` with
  `{ method: "GET", path: "/_cluster/health" }` and asserts
  `[{ path: "content[0].text.status", op: "eq", expected: "green" }]`
- **THEN** the executor MUST parse the response, extract `status` from the first
  content block's text, compare it to `"green"`, and report a passing result

#### Scenario: Assertion failure produces explanation

- **WHEN** an assertion `{ path: "content[0].text.count", op: "gte", expected: 10 }`
  evaluates against a response where `count` is 3
- **THEN** the executor MUST report a failing result with an explanation stating
  the actual value (3), the operator (gte), and the expected value (10)

#### Scenario: Field path not found in response

- **WHEN** an assertion references `content[0].text.nonexistent_field` and that
  field does not exist in the response
- **THEN** the executor MUST report a failing result with an explanation that the
  field path was not found

#### Scenario: Tool call returns isError true

- **WHEN** the tool call returns `isError: true` and no assertions expect an
  error
- **THEN** the executor MUST report a failing result indicating the tool returned
  an error, including the error content

---

### Requirement: Assertion operators

The assertion engine MUST support the following operators: `eq` (deep equality),
`neq` (not equal), `gt` (greater than), `gte` (greater than or equal), `lt`
(less than), `lte` (less than or equal), `contains` (substring match for
strings, element inclusion for arrays), `exists` (field is present and not
undefined/null), `length_gte` (array or string length is at least N), and `type`
(JavaScript typeof check). An unrecognized operator MUST cause the assertion to
fail with an explanation naming the invalid operator.

#### Scenario: eq with object values

- **WHEN** the assertion is `{ path: "content[0].text.settings", op: "eq", expected: { "number_of_replicas": "1" } }`
  and the extracted value is `{ "number_of_replicas": "1" }`
- **THEN** the assertion MUST pass using deep equality comparison

#### Scenario: contains on string

- **WHEN** the assertion is `{ path: "content[0].text.message", op: "contains", expected: "success" }`
  and the extracted value is `"Operation completed with success"`
- **THEN** the assertion MUST pass

#### Scenario: contains on array

- **WHEN** the assertion is `{ path: "content[0].text.indices", op: "contains", expected: "my-index" }`
  and the extracted value is `["my-index", "other-index"]`
- **THEN** the assertion MUST pass

#### Scenario: exists with null value

- **WHEN** the assertion is `{ path: "content[0].text.field", op: "exists" }`
  and the extracted value is `null`
- **THEN** the assertion MUST fail because `null` is not considered existing

#### Scenario: length_gte on array

- **WHEN** the assertion is `{ path: "content[0].text.hits", op: "length_gte", expected: 5 }`
  and the extracted value is an array with 7 elements
- **THEN** the assertion MUST pass

#### Scenario: type check

- **WHEN** the assertion is `{ path: "content[0].text.count", op: "type", expected: "number" }`
  and the extracted value is `42`
- **THEN** the assertion MUST pass

#### Scenario: Invalid operator

- **WHEN** the assertion is `{ path: "content[0].text.x", op: "regex", expected: ".*" }`
- **THEN** the assertion MUST fail with an explanation that `regex` is not a
  supported operator

---

### Requirement: Workflow chains

The integration test runner MUST support workflow chains — an ordered sequence of
tool calls where the output of one step can feed into the arguments of the next.
Output binding MUST use a `bind` field on each step that maps a field path from
the step's response to a named variable. Subsequent steps MUST reference bound
variables in their `args` using `${var_name}` syntax. Each step MUST support its
own `assert` array. The chain MUST fail fast on the first step failure unless
`continue_on_failure: true` is set.

#### Scenario: Two-step chain with output binding

- **WHEN** step 1 calls `elasticsearch_api` with
  `{ method: "PUT", path: "/test-index" }` and binds
  `{ index_name: "content[0].text.index" }`, and step 2 calls
  `elasticsearch_api` with `{ method: "GET", path: "/${index_name}/_settings" }`
- **THEN** step 2's `path` argument MUST be resolved to `/test-index/_settings`
  using the bound variable from step 1

#### Scenario: Chain fails fast on step failure

- **WHEN** step 1 returns `isError: true` and `continue_on_failure` is not set
- **THEN** step 2 MUST NOT execute, and the chain MUST report failure at step 1

#### Scenario: Chain continues on failure when configured

- **WHEN** step 1 fails and `continue_on_failure: true` is set on the chain
- **THEN** step 2 MUST still execute (with unresolved bindings from step 1
  treated as errors), and the chain MUST report failures for both steps
  independently

#### Scenario: Per-step assertions in a chain

- **WHEN** a three-step chain has assertions on steps 1 and 3 but not step 2
- **THEN** only the assertions on steps 1 and 3 MUST be evaluated; step 2 MUST
  still execute for its output bindings

#### Scenario: Unresolved bind variable

- **WHEN** step 2 references `${index_name}` but step 1 did not produce a
  binding for `index_name`
- **THEN** the chain MUST fail with an error identifying `index_name` as an
  unresolved variable at step 2

---

### Requirement: Error handling tests

The integration test runner MUST support tests that deliberately provoke error
responses. A test MUST be able to declare `expect_error: true` to indicate the
tool call is expected to return `isError: true` or throw. When `expect_error` is
set, a successful (non-error) response MUST be treated as a test failure.
Assertions on error tests MUST run against the error content.

#### Scenario: Invalid arguments produce error

- **WHEN** a test calls `elasticsearch_api` with `{ method: "INVALID" }` and
  sets `expect_error: true`
- **THEN** the test MUST pass if the tool returns `isError: true` and MUST fail
  if the tool returns a successful response

#### Scenario: Missing required arguments

- **WHEN** a test calls `elasticsearch_api` with `{}` (missing required `method`
  and `path`) and sets `expect_error: true`
- **THEN** the test MUST pass if the tool returns an error response

#### Scenario: Nonexistent tool

- **WHEN** a test calls `nonexistent_tool_xyz` with any arguments and sets
  `expect_error: true`
- **THEN** the test MUST pass if the MCP client returns or throws an error
  indicating the tool was not found

#### Scenario: Error content assertions

- **WHEN** a test sets `expect_error: true` and asserts
  `[{ path: "content[0].text", op: "contains", expected: "authentication" }]`
  against an auth error response
- **THEN** the assertion MUST be evaluated against the error content and MUST
  pass if the error message contains "authentication"

#### Scenario: Expected error but tool succeeds

- **WHEN** a test sets `expect_error: true` but the tool returns a successful
  response
- **THEN** the test MUST report a failure explaining that an error was expected
  but the tool succeeded

---

### Requirement: Resource provider tests

The integration test runner MUST support resource provider tests that list all
resources from the MCP server and then read each one. For each resource, the
runner MUST verify that the content is non-empty (at least one content entry with
non-empty `text` or `blob`). The runner MUST optionally verify the `mimeType`
matches an expected pattern. A resource read that returns an error or empty
content MUST be reported as a failure.

#### Scenario: List and verify all resources

- **WHEN** a resource provider test is executed against a server with 3
  registered resources
- **THEN** the runner MUST call `listResources()`, then `readResource(uri)` for
  each of the 3 URIs, and report pass/fail per resource

#### Scenario: Resource with non-empty text content

- **WHEN** `readResource("elastic://docs/api/elasticsearch")` returns content
  with `text` of length 500
- **THEN** the resource test MUST pass

#### Scenario: Resource returns empty content

- **WHEN** `readResource("elastic://docs/empty")` returns content with an empty
  `text` field
- **THEN** the resource test MUST fail with an explanation that the resource
  content was empty

#### Scenario: MIME type verification

- **WHEN** a resource test expects `mimeType: "text/markdown"` and the resource
  returns `mimeType: "text/plain"`
- **THEN** the test MUST fail with an explanation of the MIME type mismatch

#### Scenario: Resource read error

- **WHEN** `readResource(uri)` throws an error for one resource but succeeds for
  others
- **THEN** the failing resource MUST be reported as a failure and the remaining
  resources MUST still be tested

---

### Requirement: Setup and teardown scripts

The integration test runner MUST support optional setup and teardown scripts at
both the suite level and the individual test level. Suite-level `setup` MUST run
once before any test in the suite. Suite-level `teardown` MUST run once after all
tests in the suite complete (including on failure). Test-level `setup` MUST run
before that specific test. Test-level `teardown` MUST run after that specific
test. Scripts MUST be executed as shell commands. A non-zero exit code from a
setup script MUST cause the associated tests to be skipped with a failure status.
A non-zero exit code from a teardown script MUST be reported as a warning but
MUST NOT change the test result.

#### Scenario: Suite setup creates test data

- **WHEN** a suite has `setup: "./scripts/seed-data.sh"` and the script exits
  with code 0
- **THEN** all tests in the suite MUST execute after the setup script completes

#### Scenario: Suite setup failure skips tests

- **WHEN** a suite has `setup: "./scripts/seed-data.sh"` and the script exits
  with code 1
- **THEN** all tests in the suite MUST be skipped and reported as failed due to
  setup failure

#### Scenario: Test-level teardown runs after failure

- **WHEN** a test has `teardown: "./scripts/cleanup.sh"` and the test itself
  fails
- **THEN** the teardown script MUST still execute after the test

#### Scenario: Teardown failure is a warning

- **WHEN** a teardown script exits with code 1
- **THEN** a warning MUST be emitted but the test result MUST NOT change from
  pass to fail

#### Scenario: Suite teardown runs after all tests

- **WHEN** a suite has 3 tests and a suite-level teardown
- **THEN** the teardown MUST run exactly once after all 3 tests complete,
  regardless of individual test outcomes

---

### Requirement: Cluster state verification

The integration test runner MUST support optional cluster state assertions that
execute direct HTTP calls to Elasticsearch or Kibana after tool execution. Each
cluster state assertion MUST specify a `url` (relative to the configured cluster
base URL), an optional `method` (default GET), and an `assert` array using the
same assertion operators as tool response assertions. The HTTP response body MUST
be parsed as JSON before assertions are applied. Authentication MUST use the same
credentials configured for the test cluster.

#### Scenario: Verify index exists after creation

- **WHEN** a test calls `elasticsearch_api` to create an index, and the cluster
  state assertion is
  `{ url: "/test-index", assert: [{ path: "test-index.settings.index.number_of_shards", op: "eq", expected: "1" }] }`
- **THEN** the runner MUST make a GET request to `<ES_URL>/test-index`, parse the
  JSON response, and evaluate the assertion

#### Scenario: Verify document was indexed

- **WHEN** a cluster state assertion is
  `{ url: "/test-index/_count", assert: [{ path: "count", op: "gte", expected: 1 }] }`
- **THEN** the runner MUST make a GET request and verify the document count is at
  least 1

#### Scenario: Cluster state assertion with POST method

- **WHEN** a cluster state assertion specifies `method: "POST"` and
  `url: "/test-index/_search"` with a `body: { "query": { "match_all": {} } }`
- **THEN** the runner MUST send a POST request with the provided body and
  evaluate assertions against the response

#### Scenario: Cluster state HTTP error

- **WHEN** the cluster state HTTP call returns a 404 status
- **THEN** the cluster state assertion MUST fail with an explanation that
  includes the HTTP status code and response body

#### Scenario: Authentication forwarding

- **WHEN** the test cluster is configured with `ES_API_KEY: "abc123"` and a
  cluster state assertion is evaluated
- **THEN** the HTTP request MUST include the same API key authentication as the
  MCP plugin's cluster connection
