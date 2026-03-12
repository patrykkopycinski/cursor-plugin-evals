## ADDED Requirements

### Requirement: Fixture recording during live runs

The fixture system MUST support a recording mode, activated via the `--record`
CLI flag, that captures every MCP tool call and response during live test
execution. For each tool call, the recorder MUST capture: `tool_name` (string),
`arguments` (the full arguments object), `argument_hash` (deterministic SHA-256
hash of the canonicalized JSON arguments), `response` (the full MCP response
including `content` and `isError`), `latency_ms` (wall-clock time for the call),
and `timestamp` (ISO-8601). Recording MUST happen alongside normal test execution
— the live results are used for test evaluation while the fixture data is
persisted.

#### Scenario: Record a single tool call

- **WHEN** `--record` is active and a test calls `elasticsearch_api` with
  `{ method: "GET", path: "/_cluster/health" }` and receives a response in 45ms
- **THEN** the recorder MUST capture a fixture entry with `tool_name:
  "elasticsearch_api"`, the full arguments, a SHA-256 hash of the canonicalized
  arguments, the full response, `latency_ms: 45`, and an ISO-8601 timestamp

#### Scenario: Record multiple tool calls in one test

- **WHEN** a test makes 3 tool calls during execution
- **THEN** all 3 calls MUST be recorded as separate entries in the fixture file
  for that test

#### Scenario: Recording does not alter test results

- **WHEN** `--record` is active
- **THEN** test evaluation MUST use the live MCP responses, not the recorded
  fixtures, and test results MUST be identical to a non-recording run

#### Scenario: Argument hash is deterministic

- **WHEN** the same tool is called with `{ path: "/a", method: "GET" }` and
  `{ method: "GET", path: "/a" }` (same keys, different order)
- **THEN** both calls MUST produce the same `argument_hash` because
  canonicalization sorts keys

---

### Requirement: Fixture storage format

Fixtures MUST be stored as compressed JSONL files (`.jsonl.gz`) with one JSON
object per line, one file per test. Each file MUST be stored at
`.evals/fixtures/<plugin-name>/<suite-name>/<test-name>.jsonl.gz`. A companion
`metadata.json` file MUST exist at the suite level
(`.evals/fixtures/<plugin-name>/<suite-name>/metadata.json`) containing: `git_sha`
(the commit SHA at recording time), `timestamp` (ISO-8601 of when recording
occurred), `cluster_version` (Elasticsearch version string from the test
cluster), and `plugin_version` (from the plugin's package.json or config).

#### Scenario: Fixture file path convention

- **WHEN** recording completes for test `health-check` in suite `cluster-ops` of
  plugin `elastic`
- **THEN** the fixture MUST be written to
  `.evals/fixtures/elastic/cluster-ops/health-check.jsonl.gz`

#### Scenario: JSONL format with one entry per line

- **WHEN** a test made 3 tool calls and the fixture file is decompressed
- **THEN** the file MUST contain exactly 3 lines, each a valid JSON object with
  `tool_name`, `arguments`, `argument_hash`, `response`, `latency_ms`, and
  `timestamp`

#### Scenario: Metadata file creation

- **WHEN** recording completes for suite `cluster-ops` at git SHA `abc1234` with
  ES version `8.17.0`
- **THEN** `.evals/fixtures/elastic/cluster-ops/metadata.json` MUST contain
  `{ "git_sha": "abc1234", "timestamp": "...", "cluster_version": "8.17.0", "plugin_version": "..." }`

#### Scenario: Fixture file is gzip compressed

- **WHEN** the fixture file is written
- **THEN** the file MUST be valid gzip and MUST decompress to valid JSONL

---

### Requirement: Fixture responder matching

The fixture responder, active in `--mock` or `mock: true` mode, MUST match
incoming tool calls against recorded fixtures using a tiered strategy. Tier 1
(exact match): match by `tool_name` AND `argument_hash`. Tier 2 (fuzzy match):
match by `tool_name` AND the value of a configured discriminator field (e.g.,
`path` for `elasticsearch_api`). Tier 3 (miss): no match found. On exact match,
the responder MUST return the recorded response. On fuzzy match, the responder
MUST return the recorded response and log a warning about the fuzzy match. On
miss, the responder MUST return a configurable fallback response (default: an
error indicating no fixture) and log an error.

#### Scenario: Exact match on tool and argument hash

- **WHEN** the LLM calls `elasticsearch_api` with arguments that hash to
  `sha256:abc123` and a fixture exists with that hash
- **THEN** the responder MUST return the recorded response from that fixture
  entry

#### Scenario: Fuzzy match on discriminator field

- **WHEN** the LLM calls `elasticsearch_api` with
  `{ method: "GET", path: "/_cluster/health", timeout: "30s" }` and no exact
  hash match exists, but a fixture exists with `tool_name: "elasticsearch_api"`
  and `arguments.path: "/_cluster/health"`
- **THEN** the responder MUST return that fixture's response and log a warning
  indicating a fuzzy match was used

#### Scenario: No match found

- **WHEN** the LLM calls `kibana_api` with arguments that match no fixture
  (neither exact nor fuzzy)
- **THEN** the responder MUST return the configured fallback response (default:
  `{ isError: true, content: [{ type: "text", text: "No fixture match" }] }`)
  and log an error

#### Scenario: Multiple fuzzy matches prefer most recent

- **WHEN** two fixture entries match on the discriminator field and both have
  `tool_name: "elasticsearch_api"` and `arguments.path: "/_cluster/health"`
- **THEN** the responder MUST prefer the more recently recorded entry (by
  timestamp)

---

### Requirement: Fixture freshness enforcement

The fixture system MUST enforce freshness checks based on the recording
timestamp in `metadata.json`. Fixtures less than 14 days old MUST be accepted
silently. Fixtures between 14 and 30 days old MUST trigger a warning during test
execution. Fixtures older than 30 days MUST cause a failure in CI mode
(`--ci` flag) and a warning in local mode. The age thresholds MUST be
configurable via the `fixture_freshness` config section.

#### Scenario: Fresh fixtures (under 14 days)

- **WHEN** the fixture metadata timestamp is 7 days ago
- **THEN** the fixture MUST be loaded without any warning

#### Scenario: Stale fixtures (14–30 days)

- **WHEN** the fixture metadata timestamp is 20 days ago
- **THEN** a warning MUST be emitted suggesting re-recording, but the test MUST
  still proceed

#### Scenario: Expired fixtures in CI mode

- **WHEN** the fixture metadata timestamp is 35 days ago and `--ci` flag is set
- **THEN** the test MUST fail with an error indicating the fixture has expired
  and needs re-recording

#### Scenario: Expired fixtures in local mode

- **WHEN** the fixture metadata timestamp is 35 days ago and `--ci` flag is NOT
  set
- **THEN** a warning MUST be emitted but the test MUST still proceed with the
  stale fixture

#### Scenario: Custom freshness thresholds

- **WHEN** the config specifies
  `fixture_freshness: { warn_after_days: 7, fail_after_days: 14 }`
- **THEN** the thresholds MUST be 7 days for warning and 14 days for failure
  instead of the defaults

---

### Requirement: Recording mode activation

Recording mode MUST be activated via the `--record` CLI flag. When `--record` is
passed, the runner MUST execute tests against a live MCP server and test cluster
while simultaneously capturing all tool call/response pairs. The `--record` flag
MUST be combinable with suite and test filters (e.g., `--record --suite
cluster-ops --test health-check`). Recording MUST overwrite any existing fixture
files for the executed tests.

#### Scenario: Record specific suite

- **WHEN** `--record --suite cluster-ops` is passed
- **THEN** only tests in the `cluster-ops` suite MUST be executed and recorded;
  other suites MUST be skipped

#### Scenario: Record overwrites existing fixtures

- **WHEN** `--record` is active and fixtures already exist for the test
- **THEN** the existing fixture file MUST be replaced with the newly recorded
  data

#### Scenario: Record requires live infrastructure

- **WHEN** `--record` is active
- **THEN** the runner MUST verify that the MCP server and test cluster are
  accessible before starting; if not, the runner MUST fail with a clear error

---

### Requirement: Replay mode activation

Replay mode MUST be activated via the `--mock` CLI flag. When `--mock` is
passed, the runner MUST NOT spawn an MCP server or require a test cluster.
Instead, the fixture responder MUST serve all tool responses from recorded
fixtures. If no fixture file exists for a test, the test MUST be skipped with
a warning indicating the missing fixture.

#### Scenario: Replay without infrastructure

- **WHEN** `--mock` is passed and no MCP server or cluster is running
- **THEN** the runner MUST proceed using fixture data without attempting to
  connect to any infrastructure

#### Scenario: Missing fixture file skips test

- **WHEN** `--mock` is active and no fixture file exists at the expected path
  for test `new-test`
- **THEN** the test MUST be skipped with a warning that no fixture was found for
  `new-test`

#### Scenario: Replay uses recorded tool catalog

- **WHEN** `--mock` is active
- **THEN** the tool catalog provided to the LLM (in LLM eval tests) MUST be
  loaded from the fixture metadata, not from a live MCP server
