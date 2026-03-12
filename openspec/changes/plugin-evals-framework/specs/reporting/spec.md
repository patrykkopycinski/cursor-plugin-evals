## ADDED Requirements

### Requirement: Terminal output formatting

The reporting system MUST render test results to the terminal as formatted tables.
Each table row MUST display the test name, pass/fail status, and per-evaluator
scores. Pass status MUST be color-coded green and fail status MUST be color-coded
red when the terminal supports color (i.e., `--no-color` is not set). After all
test rows, the reporter MUST print a summary line showing total tests run, total
passed, total failed, and overall pass rate as a percentage.

#### Scenario: Successful suite with color

- **WHEN** a suite of 3 tests completes with 2 passes and 1 failure on a
  color-capable terminal
- **THEN** the terminal output MUST display a table with 3 rows, the 2 passing
  rows MUST use green coloring, the 1 failing row MUST use red coloring, and the
  summary line MUST read `3 tests: 2 passed, 1 failed (66.7%)`

#### Scenario: All tests pass

- **WHEN** a suite of 5 tests completes with all passes
- **THEN** the summary line MUST read `5 tests: 5 passed, 0 failed (100.0%)`

#### Scenario: Per-evaluator scores in table

- **WHEN** a test uses evaluators `tool-selection` (score 0.9) and
  `response-quality` (score 0.75)
- **THEN** the table row for that test MUST display both evaluator names and
  their scores

#### Scenario: No-color mode

- **WHEN** `--no-color` is passed as a CLI flag
- **THEN** the terminal output MUST NOT include ANSI color escape codes

---

### Requirement: Markdown report generation

When the `--report` flag is provided, the reporting system MUST generate a
Markdown report file. The report MUST include: the suite name as a heading, a
results table with test name, status, evaluator scores, and timing for each test,
a detailed failure section listing each failed test with the failing evaluator
name, expected vs. actual values, and the evaluator's explanation. The report
MUST also include a metadata section with the run timestamp, model used, total
duration, and the run ID.

#### Scenario: Report file is created

- **WHEN** the CLI is invoked with `--report` and the suite completes
- **THEN** a Markdown file MUST be written to the current directory (or the path
  specified by `--output`) with the `.md` extension

#### Scenario: Suite name as heading

- **WHEN** the suite name is `elastic-integration-tests`
- **THEN** the Markdown report MUST begin with `# elastic-integration-tests`

#### Scenario: Failure details section

- **WHEN** test `create-index-test` fails with `tool-selection` score 0.4
  (threshold 0.8)
- **THEN** the failure details section MUST include the test name, the evaluator
  name `tool-selection`, the score 0.4, the threshold 0.8, and the evaluator's
  explanation text

#### Scenario: Timing per test

- **WHEN** a test takes 2340ms to complete
- **THEN** the results table MUST show the timing value `2340ms` (or equivalent
  human-readable format) for that test row

#### Scenario: Metadata section

- **WHEN** the run used model `claude-sonnet-4-20250514` and took 45 seconds total
- **THEN** the metadata section MUST include the model name, total duration, run
  timestamp, and the unique run ID

---

### Requirement: Elasticsearch export

The reporting system MUST support bulk-indexing evaluation score documents to an
Elasticsearch datastream named `kibana-evaluations`. Each document MUST include:
`@timestamp` (ISO 8601), `run_id` (unique string per invocation), `test.name`,
`suite.name`, `suite.layer`, `tool_calls` (array of tool call summaries),
`evaluator.name`, `evaluator.score`, `evaluator.label`, `evaluator.explanation`,
`model` (LLM model name), `latency_ms` (total test duration), and `token_usage`
(object with `prompt_tokens` and `completion_tokens`). The export MUST use the
Elasticsearch bulk API. The datastream format MUST be compatible with
elastic-evals dashboards.

#### Scenario: Documents indexed after suite completion

- **WHEN** a suite of 3 tests completes, each with 2 evaluators
- **THEN** 6 documents MUST be bulk-indexed to the `kibana-evaluations`
  datastream (one per test-evaluator pair)

#### Scenario: Document field completeness

- **WHEN** a document is indexed for test `cluster-health-test` using evaluator
  `tool-selection` with score 0.95 on model `gpt-4o`
- **THEN** the document MUST contain `@timestamp`, `run_id`, `test.name` =
  `"cluster-health-test"`, `evaluator.name` = `"tool-selection"`,
  `evaluator.score` = 0.95, `model` = `"gpt-4o"`, and non-null `latency_ms`
  and `token_usage` fields

#### Scenario: Token usage tracking

- **WHEN** a test consumed 1500 prompt tokens and 800 completion tokens
- **THEN** the document MUST include `token_usage.prompt_tokens` = 1500 and
  `token_usage.completion_tokens` = 800

#### Scenario: Observability cluster configuration

- **WHEN** the config specifies `infrastructure.obs_es_url` as
  `http://localhost:9210`
- **THEN** the bulk index request MUST be sent to `http://localhost:9210`

#### Scenario: Bulk API failure handling

- **WHEN** the Elasticsearch bulk API returns errors for some documents
- **THEN** the reporter MUST log a warning identifying which documents failed to
  index, and MUST NOT abort the remaining reporting pipeline

---

### Requirement: Reporting MUST support JSON output

The reporting system MUST write raw evaluation results as a JSON file when the `--output` flag is provided with a `.json` file path. The JSON MUST be an
object containing `run_id`, `timestamp`, `model`, `suites` (array of suite
results), where each suite contains `name`, `layer`, `tests` (array), and each
test contains `name`, `status`, `latency_ms`, `evaluators` (array of evaluator
results with `name`, `score`, `label`, `explanation`), and `tool_calls` (array).
The JSON MUST be valid and parseable by standard JSON parsers.

#### Scenario: JSON file written

- **WHEN** the CLI is invoked with `--output results.json` and the suite
  completes
- **THEN** a valid JSON file MUST be written to `results.json`

#### Scenario: Programmatic consumption

- **WHEN** the JSON file is read and parsed with `JSON.parse()`
- **THEN** the resulting object MUST have `run_id` (string), `timestamp` (ISO
  8601 string), `model` (string), and `suites` (array)

#### Scenario: Test result structure in JSON

- **WHEN** test `search-test` passed with evaluator `tool-args` scoring 1.0
- **THEN** the corresponding test entry in the JSON MUST include
  `name: "search-test"`, `status: "pass"`, and an evaluator entry with
  `name: "tool-args"`, `score: 1.0`, `label: "pass"`

#### Scenario: Output path with directories

- **WHEN** `--output reports/2024/results.json` is specified and the
  `reports/2024/` directory does not exist
- **THEN** the reporter MUST create the intermediate directories and write the
  file

---

### Requirement: Failure clustering

The reporting system MUST automatically classify test failures into categories.
The supported categories SHALL be: `wrong-tool` (an unexpected tool was called or
an expected tool was missed), `wrong-args` (correct tool but incorrect
arguments), `timeout` (test exceeded the configured timeout), `error-response`
(tool returned an error / `isError: true`), and `hallucination` (the LLM
response contained fabricated information as determined by the response-quality
evaluator). Each failure MUST be assigned exactly one primary category. The
failure cluster summary MUST be included in both the terminal summary output and
the Markdown report.

#### Scenario: Wrong tool classification

- **WHEN** the `tool-selection` evaluator fails with an explanation indicating a
  tool was missed
- **THEN** the failure MUST be classified as `wrong-tool`

#### Scenario: Wrong args classification

- **WHEN** the `tool-selection` evaluator passes but the `tool-args` evaluator
  fails
- **THEN** the failure MUST be classified as `wrong-args`

#### Scenario: Timeout classification

- **WHEN** a test is aborted due to exceeding the configured timeout
- **THEN** the failure MUST be classified as `timeout`

#### Scenario: Error response classification

- **WHEN** the `mcp-protocol` evaluator detects an unexpected `isError: true`
  response
- **THEN** the failure MUST be classified as `error-response`

#### Scenario: Hallucination classification

- **WHEN** the `response-quality` evaluator fails and its explanation mentions
  fabricated or inaccurate information
- **THEN** the failure MUST be classified as `hallucination`

#### Scenario: Cluster summary in terminal output

- **WHEN** 10 tests fail with 4 `wrong-tool`, 3 `wrong-args`, 2 `timeout`, and
  1 `hallucination`
- **THEN** the terminal summary MUST include a failure cluster breakdown showing
  the count per category

#### Scenario: Single primary category per failure

- **WHEN** a test fails both `tool-selection` and `tool-args` evaluators
- **THEN** the failure MUST be assigned exactly one primary category based on
  priority order: `timeout` > `error-response` > `wrong-tool` > `wrong-args` >
  `hallucination`
