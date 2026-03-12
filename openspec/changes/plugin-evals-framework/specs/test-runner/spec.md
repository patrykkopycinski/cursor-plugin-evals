## ADDED Requirements

### Requirement: Layer-based suite routing

The test runner MUST route each suite to the correct layer handler based on the
suite's `layer` field. A suite with `layer: "unit"` MUST be handled by the unit
test layer. A suite with `layer: "integration"` MUST be handled by the
integration test layer. A suite with `layer: "llm"` MUST be handled by the LLM
eval layer. If a suite specifies an unrecognized layer value, the test runner
MUST reject it with a descriptive error.

#### Scenario: Unit suite routing

- **WHEN** a suite with `layer: "unit"` is executed
- **THEN** the test runner MUST delegate all tests in that suite to the unit
  layer handler

#### Scenario: Integration suite routing

- **WHEN** a suite with `layer: "integration"` is executed
- **THEN** the test runner MUST delegate all tests in that suite to the
  integration layer handler

#### Scenario: LLM suite routing

- **WHEN** a suite with `layer: "llm"` is executed
- **THEN** the test runner MUST delegate all tests in that suite to the LLM
  eval layer handler

#### Scenario: Unknown layer rejected

- **WHEN** a suite specifies `layer: "e2e"` (not a recognized layer)
- **THEN** the test runner MUST throw an error identifying the invalid layer
  value and listing the valid options

---

### Requirement: MCP client lifecycle management

The test runner MUST manage the McpPluginClient lifecycle at the suite level. One
MCP connection MUST be established per suite before the first test executes, and
the connection MUST be disconnected after the last test in the suite completes
(or on suite failure). The test runner MUST NOT create a new MCP connection per
test. If the connection fails to establish, the entire suite MUST be marked as
an infrastructure error.

#### Scenario: One connection per suite

- **WHEN** a suite with 5 tests is executed
- **THEN** exactly one MCP connection MUST be established for the entire suite,
  and all 5 tests MUST use that same connection

#### Scenario: Disconnect after suite

- **WHEN** the last test in a suite completes
- **THEN** the MCP client MUST be disconnected and all associated resources
  MUST be released

#### Scenario: Disconnect on suite failure

- **WHEN** a test in the suite throws an unrecoverable error causing suite
  abort
- **THEN** the MCP client MUST still be disconnected in the cleanup phase

#### Scenario: Connection failure marks suite as error

- **WHEN** the MCP server fails to start or the connection times out
- **THEN** all tests in the suite MUST be reported as infrastructure errors
  (not test failures), and the suite MUST not attempt to run any tests

#### Scenario: No connection for unit suites

- **WHEN** a suite with `layer: "unit"` is executed
- **THEN** no MCP connection MUST be established, since unit tests do not
  require a live MCP server

---

### Requirement: Configurable concurrency

The test runner MUST support configurable parallel test execution within a suite.
The default concurrency MUST be 1 for integration-layer suites and 5 for
llm-layer suites. The concurrency level MUST be overridable via the suite
configuration. Tests executed in parallel MUST have isolated state — one test's
results MUST NOT affect another test's execution.

#### Scenario: Default integration concurrency

- **WHEN** an integration suite with 10 tests is executed with no concurrency
  override
- **THEN** tests MUST execute sequentially (concurrency = 1)

#### Scenario: Default LLM concurrency

- **WHEN** an LLM suite with 10 tests is executed with no concurrency override
- **THEN** up to 5 tests MUST execute in parallel

#### Scenario: Custom concurrency override

- **WHEN** a suite specifies `concurrency: 3` in its configuration
- **THEN** at most 3 tests MUST execute simultaneously

#### Scenario: Isolated parallel state

- **WHEN** two tests execute in parallel and one modifies cluster state
- **THEN** the other test's evaluators MUST only assess results from its own
  tool calls, not those of the concurrent test

#### Scenario: Concurrency of 1 means sequential

- **WHEN** a suite specifies `concurrency: 1`
- **THEN** each test MUST complete before the next test begins

---

### Requirement: Configurable repetitions

The test runner MUST support configurable repetition counts per test. The default
repetition count MUST be 1 for unit and integration layers and 3 for the LLM
layer. The count MUST be overridable via CLI (`--repeat`) or suite/test
configuration. When a test is repeated, the runner MUST aggregate results across
repetitions: the final score for each evaluator MUST be the mean of scores
across all repetitions, and the pass/fail label MUST be derived from the
aggregated score.

#### Scenario: Default unit/integration repetitions

- **WHEN** a unit or integration test is executed with no repetition override
- **THEN** it MUST run exactly once

#### Scenario: Default LLM repetitions

- **WHEN** an LLM test is executed with no repetition override
- **THEN** it MUST run 3 times

#### Scenario: CLI repeat override

- **WHEN** `--repeat 5` is passed on the CLI
- **THEN** every test MUST run 5 times, overriding layer and config defaults

#### Scenario: Score aggregation across repetitions

- **WHEN** a test runs 3 times with `tool-selection` scores of 0.8, 1.0, and
  0.9
- **THEN** the aggregated score for `tool-selection` MUST be 0.9 (the mean)

#### Scenario: Label derived from aggregated score

- **WHEN** the aggregated score is 0.85 and the threshold is 0.8
- **THEN** the label MUST be `"pass"`

#### Scenario: Individual repetition results preserved

- **WHEN** a test runs 3 times
- **THEN** the result object MUST contain both the aggregated scores and the
  per-repetition individual results for detailed inspection

---

### Requirement: Setup and teardown execution

The test runner MUST execute suite-level setup scripts before the first test in
a suite and suite-level teardown scripts after the last test completes. The
runner MUST also execute test-level setup and teardown scripts (if defined)
before and after each individual test. Setup scripts MUST complete successfully
(exit code 0) before proceeding; a non-zero exit code MUST abort the suite or
test. Teardown scripts MUST run even if the suite or test failed.

#### Scenario: Suite setup runs before first test

- **WHEN** a suite defines `setup: "./scripts/seed-data.sh"`
- **THEN** the script MUST execute before the first test in the suite begins

#### Scenario: Suite teardown runs after last test

- **WHEN** a suite defines `teardown: "./scripts/cleanup.sh"`
- **THEN** the script MUST execute after the last test completes, regardless
  of test outcomes

#### Scenario: Suite setup failure aborts suite

- **WHEN** the suite setup script exits with code 1
- **THEN** no tests in the suite MUST execute, and the suite MUST be reported
  as an infrastructure error

#### Scenario: Test-level setup and teardown

- **WHEN** a test defines `setup: "./scripts/create-index.sh"` and
  `teardown: "./scripts/delete-index.sh"`
- **THEN** the setup script MUST run before the test and the teardown script
  MUST run after the test

#### Scenario: Teardown runs on test failure

- **WHEN** a test fails and has a teardown script defined
- **THEN** the teardown script MUST still execute

#### Scenario: Teardown runs on suite failure

- **WHEN** a test in the middle of a suite throws an unrecoverable error and
  the suite defines a teardown script
- **THEN** the suite teardown MUST still execute

---

### Requirement: Result collection and aggregation

The test runner MUST collect results from all executed suites and tests, then
compute aggregate metrics. For each suite, the runner MUST compute the pass rate
(fraction of tests that passed all evaluators). For the overall run, the runner
MUST compute the total pass rate across all suites. The aggregated results MUST
be passed to the reporting system for terminal output, file generation, and
Elasticsearch export.

#### Scenario: Suite pass rate calculation

- **WHEN** a suite has 10 tests and 8 passed all evaluators
- **THEN** the suite pass rate MUST be 0.8 (80%)

#### Scenario: Overall pass rate across suites

- **WHEN** suite A has 5/5 passing and suite B has 3/5 passing
- **THEN** the overall pass rate MUST be 8/10 = 0.8 (80%)

#### Scenario: Results fed to reporting

- **WHEN** all suites complete execution
- **THEN** the aggregated results MUST be passed to the reporting system,
  containing per-test evaluator scores, timing, tool calls, and pass/fail
  status

#### Scenario: Empty suite

- **WHEN** a suite has 0 tests (all filtered out)
- **THEN** the suite MUST be reported with 0 tests run and a pass rate of 1.0
  (vacuously true), and MUST NOT cause an error

---

### Requirement: Per-test timeout

The test runner MUST enforce a configurable timeout per test. The timeout MUST be
sourced from the test-level config, falling back to the suite-level default,
falling back to the global default. When a test exceeds its timeout, the runner
MUST abort the test gracefully — cancelling any pending MCP calls or LLM
requests — and mark the test as failed with a `timeout` classification.

#### Scenario: Test completes within timeout

- **WHEN** a test has a timeout of 30000ms and completes in 5000ms
- **THEN** the test MUST proceed normally and be evaluated

#### Scenario: Test exceeds timeout

- **WHEN** a test has a timeout of 10000ms and has not completed after 10000ms
- **THEN** the test MUST be aborted, marked as failed, and classified as
  `timeout` in the failure cluster

#### Scenario: Timeout hierarchy

- **WHEN** the global default timeout is 30000ms, the suite overrides to
  60000ms, and a specific test overrides to 15000ms
- **THEN** that test MUST use 15000ms as its timeout

#### Scenario: Graceful abort on timeout

- **WHEN** a test is aborted due to timeout
- **THEN** any pending MCP tool calls MUST be cancelled, the MCP connection
  MUST remain usable for subsequent tests, and partial results MUST be
  reported

#### Scenario: Timeout does not break suite

- **WHEN** one test in a suite times out
- **THEN** the remaining tests in the suite MUST still execute

---

### Requirement: Test filtering

The test runner MUST honor filter flags from the CLI to restrict which suites
and tests are executed. The supported filters are: `--suite <name>` (match by
suite name), `--layer <unit|integration|llm>` (match by layer), and
`--test-name <pattern>` (match individual test names by substring or glob). When
multiple filters are provided, they MUST be combined with AND logic — a suite or
test MUST match all provided filters to be included.

#### Scenario: Filter by suite name

- **WHEN** `--suite elastic-tools` is provided and the config has 3 suites
- **THEN** only the suite named `elastic-tools` MUST be executed

#### Scenario: Filter by layer

- **WHEN** `--layer llm` is provided
- **THEN** only suites with `layer: "llm"` MUST be executed

#### Scenario: Filter by test name

- **WHEN** `--test-name "cluster-health"` is provided
- **THEN** only tests whose name contains `"cluster-health"` MUST be executed,
  across all matching suites

#### Scenario: Combined filters with AND logic

- **WHEN** `--layer integration --suite elastic-tools` is provided
- **THEN** only the suite named `elastic-tools` MUST be executed, and only if
  its layer is `"integration"`; if the suite's layer is `"llm"`, no tests
  MUST run

#### Scenario: No matches found

- **WHEN** the filters match zero suites or tests
- **THEN** the runner MUST print a warning indicating no tests matched the
  filters and exit with code 0

#### Scenario: Suite-level filter excludes entire suite

- **WHEN** `--suite nonexistent` is provided and no suite has that name
- **THEN** the runner MUST print a warning and exit with code 0
