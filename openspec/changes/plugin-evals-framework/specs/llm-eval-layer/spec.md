## ADDED Requirements

### Requirement: Agent loop execution

The LLM eval layer MUST implement an agent loop that sends a system prompt, the
full tool catalog (discovered from the MCP server via `listTools()`), and a user
prompt to the configured LLM. When the LLM responds with tool calls, the adapter
MUST execute each tool call via the `McpPluginClient` and feed the results back
to the LLM as tool-result messages. The loop MUST iterate until the LLM produces
a final text response (no more tool calls) or the configured `max_turns` limit
is reached. Each iteration MUST append to a conversation history that is
preserved across turns.

#### Scenario: Single-turn completion

- **WHEN** the LLM receives the prompt "What is the cluster health?" and
  responds with a single `elasticsearch_api` tool call, then produces a final
  text response after receiving the tool result
- **THEN** the agent loop MUST complete in 2 turns (1 tool call + 1 final
  response) and return the final text

#### Scenario: Multi-turn tool use

- **WHEN** the LLM requires 3 sequential tool calls to answer a complex query
  (e.g., discover indices, query one, summarize results)
- **THEN** the agent loop MUST execute all 3 tool calls in sequence, feeding
  each result back, and return the final text after the last turn

#### Scenario: Parallel tool calls in a single turn

- **WHEN** the LLM responds with 2 tool calls in a single message
- **THEN** the adapter MUST execute both tool calls (concurrently if possible),
  collect both results, and feed them back to the LLM in a single message

#### Scenario: Max turns reached

- **WHEN** `max_turns` is set to 5 and the LLM has not produced a final text
  response after 5 turns
- **THEN** the agent loop MUST stop, return the conversation history so far, and
  mark the result as `max_turns_reached: true`

#### Scenario: LLM responds with text immediately

- **WHEN** the LLM produces a text response without any tool calls
- **THEN** the agent loop MUST complete in 1 turn and return the text response

---

### Requirement: System prompt construction

The LLM eval layer MUST construct the system prompt by combining a base system
prompt with the plugin's contextual information. The system prompt MUST include
the plugin name, the list of available tools with their descriptions and input
schemas (from MCP discovery), and any skill or rule content specified in the test
configuration. Tool descriptions MUST be injected in a format compatible with the
target LLM's tool-use protocol (e.g., OpenAI function calling format, Anthropic
tool use format).

#### Scenario: System prompt includes tool catalog

- **WHEN** the MCP server exposes 5 tools and the system prompt is constructed
- **THEN** the system prompt MUST contain the name, description, and input schema
  for all 5 tools

#### Scenario: System prompt includes skill content

- **WHEN** the test specifies `skills: ["./skills/elasticsearch-query.md"]`
- **THEN** the system prompt MUST include the content of that skill file appended
  to the base system prompt

#### Scenario: System prompt includes rule content

- **WHEN** the test specifies `rules: ["./rules/safety.md"]`
- **THEN** the system prompt MUST include the content of that rule file in the
  system prompt

#### Scenario: Empty tool catalog

- **WHEN** the MCP server exposes 0 tools
- **THEN** the system prompt MUST still be constructed without tool descriptions
  and the agent loop MUST proceed (the LLM can only respond with text)

---

### Requirement: Mock mode with fixture responder

The LLM eval layer MUST support a mock mode where MCP tool execution is replaced
by a fixture responder. In mock mode, no MCP server or test cluster is required.
The LLM MUST still be called with the real system prompt and tool catalog (loaded
from a recorded fixture manifest). When the LLM generates tool calls, the
fixture responder MUST return recorded responses. Mock mode MUST be activated
via the `--mock` flag or `mock: true` in the test configuration.

#### Scenario: Mock mode uses fixture responses

- **WHEN** mock mode is active and the LLM calls `elasticsearch_api` with
  `{ method: "GET", path: "/_cluster/health" }`
- **THEN** the fixture responder MUST return the recorded response for that tool
  call instead of calling the MCP server

#### Scenario: Mock mode loads tool catalog from fixtures

- **WHEN** mock mode is active
- **THEN** the tool catalog MUST be loaded from the fixture manifest's recorded
  tool list, not from a live MCP server

#### Scenario: Mock mode fixture miss

- **WHEN** mock mode is active and the LLM calls a tool with arguments that have
  no matching fixture
- **THEN** the fixture responder MUST return a configurable fallback (default: an
  error response indicating no fixture match) and log a warning

#### Scenario: No MCP server required in mock mode

- **WHEN** mock mode is active
- **THEN** the runner MUST NOT attempt to spawn or connect to an MCP server
  process

---

### Requirement: Multi-model support

The LLM eval layer MUST support running the same test against multiple LLM
models. The `models` field in a test or suite configuration MUST accept an array
of model identifiers (e.g., `["claude-sonnet-4-20250514", "gpt-4o", "gemini-2.0-flash"]`).
The runner MUST execute the test once per model and report results separately,
keyed by model name. Each model run MUST use the same system prompt, user prompt,
and tool catalog.

#### Scenario: Same test across two models

- **WHEN** a test specifies `models: ["claude-sonnet-4-20250514", "gpt-4o"]`
- **THEN** the runner MUST execute the test twice — once with Claude, once with
  GPT-4o — and produce two independent result records

#### Scenario: Model-specific results

- **WHEN** Claude passes a test but GPT-4o fails it
- **THEN** the results MUST show Claude as passing and GPT-4o as failing, each
  with their own scores, turn counts, and token usage

#### Scenario: Invalid model identifier

- **WHEN** a test specifies `models: ["nonexistent-model-xyz"]`
- **THEN** the runner MUST report an error for that model indicating the model
  could not be initialized, without affecting other models in the array

#### Scenario: Default model from config

- **WHEN** a test does not specify `models` and the global config has
  `defaults.judge_model: "gpt-4o"`
- **THEN** the test MUST run against `gpt-4o` as the sole model

---

### Requirement: A/B comparison testing

The LLM eval layer MUST support A/B comparison tests that run the same prompt
with two different configurations and compare the resulting scores. The test MUST
specify a `baseline` configuration and a `variant` configuration. Each
configuration MUST independently define which skills and rules are loaded into
the system prompt. The runner MUST execute both configurations and report a
comparison including per-evaluator score deltas, win/loss/tie counts across
repetitions, and a summary indicating which configuration performed better.

#### Scenario: Compare with and without a skill

- **WHEN** a test sets `baseline: { skills: [] }` and
  `variant: { skills: ["./skills/elasticsearch-query.md"] }`
- **THEN** the runner MUST execute the test twice (once per configuration) and
  report the score delta for each evaluator

#### Scenario: A/B with multiple repetitions

- **WHEN** the test specifies `repetitions: 5` for an A/B comparison
- **THEN** each configuration MUST be run 5 times, and the comparison MUST
  report win/loss/tie counts and mean score per configuration

#### Scenario: Variant outperforms baseline

- **WHEN** the variant achieves a mean `tool-selection` score of 0.95 and the
  baseline achieves 0.70
- **THEN** the comparison MUST report the variant as the winner for
  `tool-selection` with a delta of +0.25

#### Scenario: Statistical tie

- **WHEN** baseline and variant mean scores differ by less than 0.05 across
  repetitions
- **THEN** the comparison MUST report the result as a tie for that evaluator

---

### Requirement: Token tracking

The LLM eval layer MUST track token usage for every LLM call within a test run.
The tracker MUST record `input_tokens`, `output_tokens`, and `cached_tokens` (if
reported by the provider) per turn. The test result MUST include a `token_usage`
summary with per-turn counts and totals across all turns. Token counts MUST be
extracted from the LLM provider's response metadata.

#### Scenario: Single-turn token tracking

- **WHEN** a test completes in 1 turn with the LLM reporting 500 input tokens
  and 150 output tokens
- **THEN** the result's `token_usage` MUST show
  `{ turns: [{ input: 500, output: 150, cached: 0 }], total: { input: 500, output: 150, cached: 0 } }`

#### Scenario: Multi-turn token accumulation

- **WHEN** a test completes in 3 turns with input/output tokens of
  (500/100), (800/150), (1100/200)
- **THEN** the total MUST be `{ input: 2400, output: 450 }` and per-turn
  breakdown MUST be preserved

#### Scenario: Cached tokens from provider

- **WHEN** the LLM provider reports `cached_tokens: 300` on the second turn
  (prompt caching hit)
- **THEN** the second turn's token record MUST include `cached: 300`

#### Scenario: Provider does not report tokens

- **WHEN** the LLM provider does not include token metadata in its response
- **THEN** the token fields MUST be set to `null` and a warning MUST be emitted

---

### Requirement: Timeout handling

The LLM eval layer MUST enforce a configurable timeout for each test. If the
total elapsed time (across all agent loop turns) exceeds the timeout, the runner
MUST abort the test. On abort, the runner MUST return a partial result containing
the conversation history up to the point of timeout, any evaluator scores that
can be computed from partial data, and a flag `timed_out: true`. In-flight LLM
calls and MCP tool calls MUST be cancelled or abandoned on timeout.

#### Scenario: Test completes within timeout

- **WHEN** a test with `timeout: 60000` completes in 15 seconds
- **THEN** the result MUST have `timed_out: false` and contain full results

#### Scenario: Test exceeds timeout

- **WHEN** a test with `timeout: 10000` has been running for 10 seconds with an
  LLM call still in flight
- **THEN** the runner MUST abort the LLM call, set `timed_out: true`, and return
  the partial conversation history

#### Scenario: Partial evaluator scores on timeout

- **WHEN** a test times out after 2 of 4 expected tool calls
- **THEN** the `tool-selection` evaluator MUST be run against the 2 completed
  calls and the result MUST include the partial score with an annotation that the
  test was incomplete

#### Scenario: Timeout with default value

- **WHEN** no `timeout` is specified in the test or suite and the global default
  is `30000`
- **THEN** the test MUST timeout after 30 seconds if still running
