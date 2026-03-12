## ADDED Requirements

### Requirement: run subcommand

The CLI MUST provide a `run` subcommand that executes test suites. The `run`
subcommand MUST accept the following flags:
- `--layer <unit|integration|llm>`: filter suites by layer
- `--suite <name>`: run only the named suite
- `--mock`: use mock MCP responses instead of a live plugin
- `--model <model>`: override the LLM model for llm-layer tests
- `--repeat <n>`: override the repetition count per test
- `--report`: generate a Markdown report after completion
- `--output <path>`: write raw JSON results to the specified path
- `--ci`: enforce configured thresholds and exit non-zero on any failure

All flags MUST be optional. When no filters are provided, all suites in the
config MUST be executed.

#### Scenario: Run all suites

- **WHEN** `plugin-eval run` is invoked with no filter flags
- **THEN** every suite defined in the config MUST be executed

#### Scenario: Filter by layer

- **WHEN** `plugin-eval run --layer unit` is invoked
- **THEN** only suites with `layer: "unit"` MUST be executed

#### Scenario: Filter by suite name

- **WHEN** `plugin-eval run --suite elastic-tools` is invoked
- **THEN** only the suite named `elastic-tools` MUST be executed; all other
  suites MUST be skipped

#### Scenario: Mock mode

- **WHEN** `plugin-eval run --mock` is invoked
- **THEN** the test runner MUST use recorded fixtures or mock responses instead
  of connecting to a live MCP server

#### Scenario: Model override

- **WHEN** `plugin-eval run --model gpt-4o` is invoked
- **THEN** all llm-layer tests MUST use `gpt-4o` as the model, overriding the
  config default

#### Scenario: Repeat override

- **WHEN** `plugin-eval run --repeat 5` is invoked
- **THEN** every test MUST be executed 5 times, overriding the config default

#### Scenario: CI mode enforces thresholds

- **WHEN** `plugin-eval run --ci` is invoked and a test's evaluator score falls
  below its configured threshold
- **THEN** the CLI MUST exit with code 1

#### Scenario: CI mode passes when all thresholds met

- **WHEN** `plugin-eval run --ci` is invoked and all evaluator scores meet or
  exceed their configured thresholds
- **THEN** the CLI MUST exit with code 0

#### Scenario: Report and output combined

- **WHEN** `plugin-eval run --report --output results.json` is invoked
- **THEN** both a Markdown report and a JSON output file MUST be generated

---

### Requirement: record subcommand

The CLI MUST provide a `record` subcommand that runs integration or llm-layer
tests against a live cluster and MCP server, then persists the tool call
inputs, outputs, and LLM responses as fixture files. The recorded fixtures MUST
be stored in the directory specified by the config or a default
`fixtures/` directory relative to the config file.

#### Scenario: Record integration fixtures

- **WHEN** `plugin-eval record --suite elastic-integration` is invoked with a
  live test cluster running
- **THEN** each test's tool call arguments, responses, and timing MUST be saved
  as fixture files

#### Scenario: Record llm fixtures

- **WHEN** `plugin-eval record --suite elastic-llm` is invoked
- **THEN** each test's LLM prompt, response, tool calls, and tool responses MUST
  be saved as fixture files

#### Scenario: Fixture file format

- **WHEN** a fixture is recorded
- **THEN** the fixture file MUST be valid JSON containing `tool_calls` (array),
  `responses` (array), and `metadata` (object with timestamp and model)

#### Scenario: Overwrite existing fixtures

- **WHEN** `plugin-eval record` is invoked and fixtures already exist for the
  suite
- **THEN** the existing fixtures MUST be overwritten with the new recordings

---

### Requirement: replay subcommand

The CLI MUST provide a `replay` subcommand that re-scores previously recorded
fixture outputs against the current evaluator implementations. The `replay`
subcommand MUST NOT connect to an MCP server or LLM. It MUST load fixture files
and feed the recorded outputs through the configured evaluators.

#### Scenario: Replay without live services

- **WHEN** `plugin-eval replay --suite elastic-integration` is invoked with no
  MCP server or cluster running
- **THEN** the command MUST succeed using only recorded fixture data

#### Scenario: Re-score with updated evaluators

- **WHEN** an evaluator's scoring logic has been modified and `replay` is invoked
- **THEN** the scores MUST reflect the updated evaluator logic, not the
  originally recorded scores

#### Scenario: Missing fixture file

- **WHEN** `plugin-eval replay --suite missing-suite` is invoked and no fixture
  files exist for that suite
- **THEN** the CLI MUST exit with code 2 and print an error identifying the
  missing fixtures

---

### Requirement: doctor subcommand

The CLI MUST provide a `doctor` subcommand that checks the health of all
infrastructure and configuration prerequisites. The doctor MUST check: Docker
service status (are required containers running and healthy), plugin build status
(does the built entry point exist), required environment variables (are all
`${VAR}` references resolvable), and LLM API key availability (is the configured
model's API key set). Each check MUST report pass or fail with a descriptive
message.

#### Scenario: All checks pass

- **WHEN** `plugin-eval doctor` is invoked and all services are running, the
  plugin is built, env vars are set, and LLM keys are available
- **THEN** the doctor MUST report all checks as passing and exit with code 0

#### Scenario: Docker services not running

- **WHEN** `plugin-eval doctor` is invoked and the test Elasticsearch container
  is not running
- **THEN** the doctor MUST report the Docker check as failed, identifying which
  service is missing, and exit with code 1

#### Scenario: Plugin not built

- **WHEN** `plugin-eval doctor` is invoked and the plugin entry point file does
  not exist
- **THEN** the doctor MUST report the build check as failed and suggest running
  the build command

#### Scenario: Missing LLM API key

- **WHEN** `plugin-eval doctor` is invoked and the `OPENAI_API_KEY` environment
  variable is not set but the config uses an OpenAI model
- **THEN** the doctor MUST report the API key check as failed, naming the
  missing key

---

### Requirement: generate subcommand

The CLI MUST provide a `generate` subcommand that scaffolds a `plugin-eval.yaml`
configuration file by discovering the MCP tools exposed by a plugin. The
generator MUST connect to the plugin's MCP server, list all available tools,
and produce a config file with a suite skeleton containing one test stub per
discovered tool.

#### Scenario: Generate from live plugin

- **WHEN** `plugin-eval generate --dir ../my-plugin --entry "node dist/index.js"`
  is invoked and the plugin exposes 5 tools
- **THEN** a `plugin-eval.yaml` file MUST be written with a `plugin` section
  and a `suites` section containing 5 test stubs

#### Scenario: Test stub structure

- **WHEN** a tool named `elasticsearch_api` is discovered with parameters
  `method`, `path`, and `body`
- **THEN** the generated test stub MUST include the tool name, placeholder
  args matching the parameter names, and a default evaluator list

#### Scenario: Output path

- **WHEN** `plugin-eval generate --output custom-eval.yaml` is specified
- **THEN** the generated file MUST be written to `custom-eval.yaml`

#### Scenario: Plugin connection failure

- **WHEN** `plugin-eval generate` is invoked but the plugin MCP server fails
  to start
- **THEN** the CLI MUST exit with code 2 and print a descriptive error

---

### Requirement: Global CLI options

The CLI MUST support the following global options available to all subcommands:
- `--config <path>`: path to the config file (default: `plugin-eval.yaml` in
  the current directory)
- `--verbose`: enable verbose/debug logging output
- `--no-color`: disable color output in the terminal

#### Scenario: Custom config path

- **WHEN** `plugin-eval run --config ./custom/eval.yaml` is invoked
- **THEN** the CLI MUST load configuration from `./custom/eval.yaml` instead
  of the default path

#### Scenario: Default config path

- **WHEN** `plugin-eval run` is invoked with no `--config` flag
- **THEN** the CLI MUST look for `plugin-eval.yaml` in the current working
  directory

#### Scenario: Verbose mode

- **WHEN** `plugin-eval run --verbose` is invoked
- **THEN** the CLI MUST output additional debug information including config
  loading details, MCP connection events, and evaluator execution traces

#### Scenario: Config file not found

- **WHEN** `plugin-eval run --config missing.yaml` is invoked and the file does
  not exist
- **THEN** the CLI MUST exit with code 2 and print an error identifying the
  missing config path

---

### Requirement: Exit codes

The CLI MUST use the following exit codes consistently across all subcommands:
- `0`: all tests passed (or subcommand completed successfully)
- `1`: one or more test failures exist
- `2`: infrastructure or configuration error prevented execution

#### Scenario: Exit 0 on success

- **WHEN** all tests pass and no errors occur
- **THEN** the CLI MUST exit with code 0

#### Scenario: Exit 1 on test failure

- **WHEN** at least one test fails (evaluator score below threshold)
- **THEN** the CLI MUST exit with code 1

#### Scenario: Exit 2 on infrastructure error

- **WHEN** the MCP server fails to start, Docker services are unreachable, or
  the config file is invalid
- **THEN** the CLI MUST exit with code 2

#### Scenario: Exit 2 on missing fixtures for replay

- **WHEN** `plugin-eval replay` cannot find the required fixture files
- **THEN** the CLI MUST exit with code 2
