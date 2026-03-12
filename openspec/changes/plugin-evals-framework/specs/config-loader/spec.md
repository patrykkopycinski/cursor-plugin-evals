## ADDED Requirements

### Requirement: Load and parse plugin-eval.yaml

The config loader MUST read a `plugin-eval.yaml` file from a given path and parse
it into a typed configuration object. The loader MUST support both absolute paths
and paths relative to the current working directory. If the file does not exist or
is not valid YAML, the loader MUST throw a descriptive error.

#### Scenario: Load valid config file

- **WHEN** `loadConfig("./plugin-eval.yaml")` is called and the file exists with
  valid YAML
- **THEN** the loader MUST return a fully typed configuration object

#### Scenario: File not found

- **WHEN** `loadConfig("./missing.yaml")` is called and the file does not exist
- **THEN** the loader MUST throw an error with a message indicating the file path
  that was not found

#### Scenario: Invalid YAML syntax

- **WHEN** the file contains malformed YAML (e.g., unclosed quotes, bad
  indentation)
- **THEN** the loader MUST throw an error with the YAML parse error and line
  number

---

### Requirement: Plugin section configuration

The config MUST include a `plugin` section with the following fields:
- `name` (string, required): The plugin identifier
- `dir` (string, optional): Path to the plugin directory; if omitted, the
  `PLUGIN_DIR` environment variable MUST be used
- `entry` (string, required): Entry point command and arguments for the MCP server
- `build_command` (string, optional): Build command to run before spawning the
  server
- `env` (Record<string, string>, optional): Environment variables to pass to the
  MCP server process

#### Scenario: Full plugin section

- **WHEN** the config contains
  `plugin: { name: "elastic", dir: "../elastic-cursor-plugin", entry: "node dist/index.js", build_command: "npm run build", env: { ES_URL: "http://localhost:9200" } }`
- **THEN** all fields MUST be accessible on the parsed config object

#### Scenario: Plugin dir from environment variable

- **WHEN** the config omits `plugin.dir` and `PLUGIN_DIR=/path/to/plugin` is set
  in the environment
- **THEN** the resolved plugin directory MUST be `/path/to/plugin`

#### Scenario: Missing plugin dir with no env var

- **WHEN** the config omits `plugin.dir` and `PLUGIN_DIR` is not set
- **THEN** the loader MUST throw a validation error indicating that either
  `plugin.dir` or `PLUGIN_DIR` env var is required

---

### Requirement: Infrastructure section configuration

The config MUST support an `infrastructure` section with the following fields:
- `docker_compose` (string, optional): Path to the Docker Compose file
- `obs_es_url` (string, optional): URL of the observability Elasticsearch cluster

#### Scenario: Infrastructure section present

- **WHEN** the config contains
  `infrastructure: { docker_compose: "./docker/docker-compose.yml", obs_es_url: "http://localhost:9201" }`
- **THEN** both fields MUST be accessible on the parsed config object

#### Scenario: Infrastructure section omitted

- **WHEN** the config does not include an `infrastructure` section
- **THEN** the parsed config MUST have `infrastructure` as `undefined` or with
  default empty values, and MUST NOT throw

---

### Requirement: Tracing section configuration

The config MUST support a `tracing` section with the following fields:
- `otel_endpoint` (string, optional): OpenTelemetry collector endpoint URL
- `langsmith_project` (string, optional): LangSmith project name for trace export

#### Scenario: Tracing fully configured

- **WHEN** the config contains
  `tracing: { otel_endpoint: "http://localhost:4318", langsmith_project: "plugin-evals" }`
- **THEN** both fields MUST be accessible on the parsed config object

#### Scenario: Tracing section omitted

- **WHEN** the config does not include a `tracing` section
- **THEN** the parsed config MUST have `tracing` as `undefined` and MUST NOT
  throw

---

### Requirement: Defaults section configuration

The config MUST support a `defaults` section with the following fields:
- `timeout` (number, optional): Default timeout in milliseconds for tool calls
- `judge_model` (string, optional): Default LLM model for evaluator judges
- `repetitions` (number, optional): Default number of repetitions per LLM eval
  test
- `thresholds` (Record<string, number>, optional): Default pass/fail thresholds
  keyed by evaluator name

#### Scenario: All defaults specified

- **WHEN** the config contains
  `defaults: { timeout: 30000, judge_model: "gpt-4o", repetitions: 3, thresholds: { tool-selection: 0.9, response-quality: 0.7 } }`
- **THEN** all default values MUST be accessible on the parsed config object

#### Scenario: Partial defaults

- **WHEN** the config specifies only `defaults: { timeout: 15000 }`
- **THEN** `timeout` MUST be 15000, and all other default fields MUST be
  `undefined` or use hardcoded fallback values

---

### Requirement: Suites section configuration

The config MUST support a `suites` section containing an array of test suite
definitions. Each suite MUST have:
- `name` (string, required): Suite identifier
- `layer` (enum, required): One of `"unit"`, `"integration"`, or `"llm"`
- `setup` (string, optional): Path to a setup script run before the suite
- `teardown` (string, optional): Path to a teardown script run after the suite
- `defaults` (object, optional): Suite-level default overrides (same shape as
  top-level `defaults`)
- `tests` (array, required): Array of test definitions whose format depends on
  the layer

#### Scenario: Suite with unit layer

- **WHEN** a suite has `layer: "unit"` and tests with registration check configs
- **THEN** the parsed suite MUST have `layer` set to `"unit"` and tests parsed as
  unit test definitions

#### Scenario: Suite with integration layer

- **WHEN** a suite has `layer: "integration"` and tests with `tool`, `args`, and
  `assert` fields
- **THEN** the parsed suite MUST have tests with `tool` (string), `args`
  (object), and `assert` (assertion config)

#### Scenario: Suite with llm layer

- **WHEN** a suite has `layer: "llm"` and tests with `prompt`, `expected`, and
  `evaluators` fields
- **THEN** the parsed suite MUST have tests with `prompt` (string), `expected`
  (object), and `evaluators` (array of evaluator names)

---

### Requirement: Suite-level defaults override global defaults

When a suite specifies its own `defaults` section, those values MUST override the
corresponding top-level `defaults` values for all tests within that suite.
Unspecified suite-level fields MUST fall back to the global defaults.

#### Scenario: Suite overrides timeout

- **WHEN** global `defaults.timeout` is 30000 and a suite specifies
  `defaults: { timeout: 60000 }`
- **THEN** tests in that suite MUST use timeout 60000

#### Scenario: Suite inherits unoverridden defaults

- **WHEN** global `defaults.judge_model` is `"gpt-4o"` and a suite overrides only
  `timeout`
- **THEN** tests in that suite MUST use `judge_model: "gpt-4o"` from the global
  defaults

#### Scenario: Multiple suites with different overrides

- **WHEN** suite A overrides `timeout: 10000` and suite B overrides
  `timeout: 60000`
- **THEN** suite A tests MUST use 10000 and suite B tests MUST use 60000

---

### Requirement: Zod schema validation

The config loader MUST validate the parsed YAML against a Zod schema. Validation
errors MUST produce helpful, human-readable error messages that identify the
exact field path and the constraint that was violated.

#### Scenario: Missing required field

- **WHEN** `plugin.name` is omitted from the config
- **THEN** the loader MUST throw a validation error identifying
  `plugin.name` as required

#### Scenario: Invalid field type

- **WHEN** `defaults.timeout` is set to `"not-a-number"`
- **THEN** the loader MUST throw a validation error indicating that
  `defaults.timeout` must be a number

#### Scenario: Invalid layer enum

- **WHEN** a suite has `layer: "e2e"` (not one of unit/integration/llm)
- **THEN** the loader MUST throw a validation error listing the valid layer values

#### Scenario: Valid config passes validation

- **WHEN** a config file satisfies all Zod schema constraints
- **THEN** the loader MUST return the parsed config without errors

---

### Requirement: Environment variable interpolation

The config loader MUST support `${VAR_NAME}` syntax in string values. Before
validation, the loader MUST replace all `${VAR_NAME}` occurrences with the
corresponding value from `process.env`. If a referenced environment variable is
not set, the loader MUST throw an error identifying the unresolved variable.

#### Scenario: Interpolate existing variable

- **WHEN** the config contains `plugin.dir: "${PLUGIN_DIR}/packages/mcp-server"`
  and `PLUGIN_DIR=/home/user/plugins`
- **THEN** the resolved value MUST be `/home/user/plugins/packages/mcp-server`

#### Scenario: Multiple interpolations in one value

- **WHEN** the config contains `env.ES_URL: "${ES_PROTOCOL}://${ES_HOST}:${ES_PORT}"`
  with `ES_PROTOCOL=https`, `ES_HOST=localhost`, `ES_PORT=9200`
- **THEN** the resolved value MUST be `https://localhost:9200`

#### Scenario: Unresolved variable

- **WHEN** the config contains `${UNDEFINED_VAR}` and that variable is not set in
  the environment
- **THEN** the loader MUST throw an error naming `UNDEFINED_VAR` as unresolved

#### Scenario: No interpolation needed

- **WHEN** a string value contains no `${}` syntax
- **THEN** the value MUST be passed through unchanged
