## ADDED Requirements

### Requirement: Evaluator interface contract

Every evaluator MUST implement a common interface with the following properties:
`name` (string identifier), `kind` (either `CODE` or `LLM`), and an
`evaluate(params)` method that returns an `EvaluationResult`. The
`EvaluationResult` MUST contain `score` (number 0–1), `label` (string:
`"pass"`, `"fail"`, or `"partial"`), and `explanation` (human-readable string
describing the reasoning). A `CODE` evaluator MUST be deterministic and MUST NOT
call an LLM. An `LLM` evaluator MUST call an LLM as part of its scoring logic.

#### Scenario: CODE evaluator returns deterministic result

- **WHEN** a CODE evaluator is called twice with identical inputs
- **THEN** it MUST return identical `score`, `label`, and `explanation` values

#### Scenario: EvaluationResult structure

- **WHEN** any evaluator's `evaluate()` method resolves
- **THEN** the result MUST contain `score` (number between 0 and 1 inclusive),
  `label` (one of `"pass"`, `"fail"`, `"partial"`), and `explanation` (non-empty
  string)

#### Scenario: Label derived from score and threshold

- **WHEN** an evaluator produces a score of 0.85 and the configured threshold
  for that evaluator is 0.8
- **THEN** the label MUST be `"pass"`

#### Scenario: Score below threshold

- **WHEN** an evaluator produces a score of 0.5 and the configured threshold is
  0.8
- **THEN** the label MUST be `"fail"`

---

### Requirement: tool-selection evaluator

The `tool-selection` evaluator (kind: `CODE`) MUST compare the list of tool
names actually called during a test against the list of expected tool names. The
evaluator MUST compute recall (fraction of expected tools that were called) and
F1 score (harmonic mean of precision and recall). The final `score` MUST be the
F1 score. The evaluator MUST support fuzzy matching where tool name prefixes or
aliases are configured as equivalent (e.g., `elasticsearch_api` matches
`es_api`). The pass/fail threshold MUST be configurable per test (default 0.8).

#### Scenario: Perfect tool selection

- **WHEN** the expected tools are `["elasticsearch_api", "esql_query"]` and the
  actual tools called are `["elasticsearch_api", "esql_query"]`
- **THEN** the score MUST be 1.0 (precision=1.0, recall=1.0, F1=1.0) and the
  label MUST be `"pass"`

#### Scenario: Missing one expected tool

- **WHEN** the expected tools are `["elasticsearch_api", "esql_query"]` and only
  `["elasticsearch_api"]` was called
- **THEN** recall MUST be 0.5, and the explanation MUST list `esql_query` as a
  missed tool

#### Scenario: Extra unexpected tool called

- **WHEN** the expected tools are `["elasticsearch_api"]` and the actual calls
  are `["elasticsearch_api", "kibana_api"]`
- **THEN** precision MUST be 0.5, recall MUST be 1.0, and the F1 score MUST
  reflect both

#### Scenario: Fuzzy matching with aliases

- **WHEN** fuzzy aliases map `es_api` to `elasticsearch_api`, and the expected
  list is `["es_api"]` while the actual call used `elasticsearch_api`
- **THEN** the evaluator MUST treat them as a match

#### Scenario: No tools called when tools expected

- **WHEN** the expected tools are `["elasticsearch_api"]` and no tools were
  called
- **THEN** the score MUST be 0.0 and the label MUST be `"fail"`

---

### Requirement: tool-args evaluator

The `tool-args` evaluator (kind: `CODE`) MUST validate that key arguments in
actual tool calls match expected values. For each expected tool call, the
evaluator MUST compare argument values using deep equality for objects and
arrays, strict equality for primitives, and substring containment for string
fields marked with `contains: true`. The score MUST be the fraction of expected
argument fields that matched. The evaluator MUST produce per-field match details
in the explanation.

#### Scenario: All arguments match

- **WHEN** the expected args are `{ method: "GET", path: "/_cluster/health" }`
  and the actual args are `{ method: "GET", path: "/_cluster/health" }`
- **THEN** the score MUST be 1.0

#### Scenario: Partial argument match

- **WHEN** the expected args have 4 fields and 3 match
- **THEN** the score MUST be 0.75 and the explanation MUST identify the
  mismatched field

#### Scenario: Deep equality for nested objects

- **WHEN** the expected args include `body: { query: { match_all: {} } }` and
  the actual args include `body: { query: { match_all: {} } }`
- **THEN** the `body` field MUST be considered a match

#### Scenario: String contains matching

- **WHEN** the expected arg is
  `{ path: { value: "_search", contains: true } }` and the actual arg
  `path` is `/my-index/_search`
- **THEN** the `path` field MUST be considered a match because `_search` is a
  substring

#### Scenario: Extra actual arguments are ignored

- **WHEN** the expected args are `{ method: "GET" }` and the actual args are
  `{ method: "GET", path: "/", timeout: 5000 }`
- **THEN** the score MUST be 1.0 because all expected fields matched (extra
  fields are not penalized)

---

### Requirement: tool-sequence evaluator

The `tool-sequence` evaluator (kind: `CODE`) MUST verify that tools were called
in the expected order using subsequence matching. The expected sequence MUST be a
strict subsequence of the actual call sequence — all expected tools MUST appear
in the actual calls in the same relative order, but additional calls between them
are permitted. The score MUST be 1.0 if the subsequence matches and 0.0 if it
does not. On failure, the explanation MUST identify the first expected tool that
broke the sequence.

#### Scenario: Exact sequence match

- **WHEN** the expected sequence is `["create_index", "index_document", "search"]`
  and the actual calls are `["create_index", "index_document", "search"]`
- **THEN** the score MUST be 1.0

#### Scenario: Subsequence with extra calls

- **WHEN** the expected sequence is `["create_index", "search"]` and the actual
  calls are `["create_index", "index_document", "refresh", "search"]`
- **THEN** the score MUST be 1.0 because `create_index` and `search` appear in
  order as a subsequence

#### Scenario: Out-of-order calls

- **WHEN** the expected sequence is `["create_index", "search"]` and the actual
  calls are `["search", "create_index"]`
- **THEN** the score MUST be 0.0 and the explanation MUST indicate that `search`
  was expected after `create_index` but appeared before it

#### Scenario: Missing expected tool in sequence

- **WHEN** the expected sequence is `["create_index", "index_document", "search"]`
  and the actual calls are `["create_index", "search"]`
- **THEN** the score MUST be 0.0 and the explanation MUST identify
  `index_document` as missing from the actual sequence

#### Scenario: Empty actual calls

- **WHEN** the expected sequence is `["elasticsearch_api"]` and no tools were
  called
- **THEN** the score MUST be 0.0

---

### Requirement: response-quality evaluator

The `response-quality` evaluator (kind: `LLM`) MUST use an LLM as a judge to
score the final text response for accuracy and helpfulness on a 0–1 scale. The
evaluator MUST send the judge LLM a structured prompt containing the original
user query, the expected answer or criteria (from the test config), and the
actual response. The judge prompt MUST instruct the LLM to return a JSON object
with `score` (0–1) and `reasoning` (string). The evaluator MUST parse the
judge's response and use the returned score. If the judge returns invalid JSON,
the evaluator MUST retry once and then fail with score 0.0.

#### Scenario: High-quality response

- **WHEN** the user prompt was "List all indices" and the response accurately
  lists indices with explanations
- **THEN** the judge MUST return a high score (e.g., 0.9) and the evaluator MUST
  use that score

#### Scenario: Inaccurate response

- **WHEN** the response contains factually incorrect information about the
  cluster state
- **THEN** the judge MUST return a low score and the explanation MUST describe
  the inaccuracies

#### Scenario: Judge returns invalid JSON

- **WHEN** the judge LLM returns malformed JSON on the first attempt
- **THEN** the evaluator MUST retry once; if the second attempt also fails, the
  score MUST be 0.0 with an explanation that the judge produced invalid output

#### Scenario: Judge model is configurable

- **WHEN** the test config specifies `judge_model: "gpt-4o"`
- **THEN** the evaluator MUST use GPT-4o as the judge, not the test's primary
  model

#### Scenario: Custom judging criteria

- **WHEN** the test specifies `criteria: "Response must include index count and health status"`
- **THEN** the judge prompt MUST include these criteria for evaluation

---

### Requirement: cluster-state evaluator

The `cluster-state` evaluator (kind: `CODE`) MUST execute HTTP assertions
against Elasticsearch or Kibana endpoints after tool execution to verify side
effects. Each assertion MUST specify a `url` (relative path), optional `method`
(default GET), optional `body`, and an `assert` array using the standard
assertion operators (eq, neq, gt, gte, lt, lte, contains, exists, length_gte,
type). The HTTP response MUST be parsed as JSON. The evaluator's score MUST be
the fraction of assertions that passed. Authentication MUST use the cluster
credentials from the test configuration.

#### Scenario: All cluster state assertions pass

- **WHEN** the evaluator runs 3 HTTP assertions and all pass
- **THEN** the score MUST be 1.0

#### Scenario: Partial cluster state assertion pass

- **WHEN** the evaluator runs 4 HTTP assertions and 3 pass
- **THEN** the score MUST be 0.75 and the explanation MUST describe the failing
  assertion

#### Scenario: Index creation side effect

- **WHEN** a tool created index `test-abc` and the assertion checks
  `{ url: "/test-abc", assert: [{ path: "test-abc.settings.index.number_of_shards", op: "eq", expected: "1" }] }`
- **THEN** the evaluator MUST GET the index settings and verify the shard count

#### Scenario: HTTP call failure

- **WHEN** the HTTP call to the cluster returns a non-2xx status
- **THEN** that assertion MUST fail with the HTTP status and response body in the
  explanation

#### Scenario: Authentication uses cluster credentials

- **WHEN** the cluster config specifies `ES_API_KEY: "key123"`
- **THEN** all HTTP requests MUST include the `Authorization: ApiKey key123`
  header

---

### Requirement: mcp-protocol evaluator

The `mcp-protocol` evaluator (kind: `CODE`) MUST validate that all MCP tool
calls made during a test were well-formed. For each tool call, the evaluator MUST
verify: the tool name exists in the server's tool catalog, the arguments are
parseable as JSON, and the response did not have `isError: true` (unless the test
explicitly expected an error). The score MUST be the fraction of tool calls that
passed all checks. The explanation MUST list each invalid call with the specific
violation.

#### Scenario: All calls well-formed

- **WHEN** 5 tool calls were made, all with valid names, parseable args, and
  non-error responses
- **THEN** the score MUST be 1.0

#### Scenario: One call has invalid tool name

- **WHEN** 3 tool calls were made and one used a tool name not in the catalog
- **THEN** the score MUST be approximately 0.67 and the explanation MUST identify
  the invalid tool name

#### Scenario: Call with unparseable arguments

- **WHEN** a tool call included arguments that are not valid JSON
- **THEN** that call MUST be flagged as invalid and the explanation MUST include
  the parse error

#### Scenario: Error response on unexpected call

- **WHEN** a tool call returned `isError: true` and the test did not set
  `expect_error: true`
- **THEN** that call MUST be flagged and the explanation MUST include the error
  content

#### Scenario: Expected error calls are exempt

- **WHEN** a test sets `expect_error: true` for a specific call and the call
  returned `isError: true`
- **THEN** that call MUST NOT be flagged as a protocol violation

---

### Requirement: security evaluator

The `security` evaluator (kind: `CODE`) MUST scan all tool call arguments, tool
responses, and the final LLM response for leaked credentials. The evaluator MUST
check for patterns matching: API keys (base64-encoded strings of 20+ characters
prefixed by common key identifiers), bearer tokens, passwords in plaintext (keys
containing `password`, `secret`, `token`, `api_key`, `apikey` with non-redacted
values), AWS access keys, and private key material (PEM headers). The score MUST
be 1.0 if no leaks are detected and 0.0 if any leak is found. The explanation
MUST describe the type and location of each detected leak without reproducing the
leaked value.

#### Scenario: No credentials in output

- **WHEN** the tool responses and final answer contain no credential patterns
- **THEN** the score MUST be 1.0

#### Scenario: API key leaked in tool response

- **WHEN** a tool response contains `"api_key": "dXNlcjpwYXNzd29yZDEyMzQ1Njc4OQ=="`
- **THEN** the score MUST be 0.0 and the explanation MUST state that a
  base64-encoded API key was found in a tool response, without reproducing the
  key value

#### Scenario: Password in LLM final response

- **WHEN** the LLM's final text response contains
  `"The password is supersecret123"`
- **THEN** the score MUST be 0.0 and the explanation MUST state that a password
  was found in the final response

#### Scenario: PEM private key material

- **WHEN** any output contains `-----BEGIN RSA PRIVATE KEY-----`
- **THEN** the score MUST be 0.0 and the explanation MUST identify PEM private
  key material

#### Scenario: Redacted values are safe

- **WHEN** a tool response contains `"api_key": "****"` or
  `"password": "[REDACTED]"`
- **THEN** the evaluator MUST NOT flag these as leaks and the score MUST remain
  1.0

#### Scenario: AWS access key pattern

- **WHEN** any output contains a string matching the AWS access key pattern
  (`AKIA` followed by 16 alphanumeric characters)
- **THEN** the score MUST be 0.0 and the explanation MUST identify an AWS access
  key leak
