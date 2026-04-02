# Adapter Guide

cursor-plugin-evals supports multiple adapters for executing test prompts. Each adapter connects to the LLM/agent differently, with distinct trade-offs in speed, fidelity, and capability.

---

## Available Adapters

| Adapter | Speed | Tool Calls | Skill Discovery | Use Case |
|---|---|---|---|---|
| `plain-llm` | ~28x faster | No (breaks on tool calls) | Injected as system prompt | Inner loop iteration |
| `cursor-cli` | ~28x slower | Yes (full agent) | Real `.cursor/` discovery | Final e2e validation |
| `mcp` | Fast | Yes (direct MCP calls) | No | Integration/unit tests |
| `headless-coder` | Moderate | Yes | Depends on config | Headless coding agent |
| `gemini-cli` | Moderate | Yes | No | Gemini model testing |
| `claude-sdk` | Moderate | Yes (full agent) | Yes (workspace isolation) | E2E Claude agent testing, CI/Docker |

---

## `plain-llm` — Direct LLM API Adapter

The fastest adapter. Makes a single API call with the skill injected as a system prompt. Ideal for iterating on test prompts, evaluator tuning, and content quality checks.

### How It Works

1. Detects the available LLM provider from environment variables
2. Injects skill content as a system prompt (if `skill_path` or `skill_dir` is configured)
3. Sends the test prompt as a user message
4. Returns the LLM's response as `finalOutput`
5. Cannot execute tool calls — breaks the loop if the LLM attempts one

### Provider Priority

| Priority | Provider | Required Env Vars | Default Model |
|---|---|---|---|
| 1 | AWS Bedrock | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `us.anthropic.claude-opus-4-6-v1` |
| 2 | Anthropic | `ANTHROPIC_API_KEY` | Configured model or Claude |
| 3 | Azure OpenAI | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` | Deployment name |
| 4 | OpenAI | `OPENAI_API_KEY` or `LITELLM_API_KEY` | Configured model |

### Configuration

```yaml
suites:
  - name: plain-llm-skills
    layer: llm
    adapter: plain-llm
    skill_dir: .cursor/skills/my-skill
    defaults:
      timeout: 60000
      judge_model: gpt-4.1
    tests:
      - name: skill activation
        prompt: "Help me set up monitoring"
        expected:
          response_contains: [observability, metrics]
        evaluators: [correctness, keywords]
```

### Capabilities

| Capability | Supported |
|---|---|
| Tool calls | **No** — breaks on tool_use response |
| Skill injection | Yes (as system prompt) |
| Multi-turn | Yes (up to 10 turns, text only) |
| Token tracking | Yes (from API response usage) |
| Concurrency | Full parallel (4+ concurrent) |
| Cost | Low (single API call per test) |

### Limitations

- Cannot execute MCP tool calls — the adapter logs a debug message and breaks the loop
- Skill is injected as system prompt text, not discovered from `.cursor/` directory
- No file system access or workspace interaction
- Not suitable for testing tool selection or tool argument accuracy in real workflows

### When to Use

- Iterating on test prompts and expected values
- Tuning LLM evaluator thresholds
- Content quality and response quality testing
- Skill activation testing (does the skill's instructions produce the right output?)
- Bulk runs where speed matters (28x faster than cursor-cli)

---

## `cursor-cli` — Full Cursor Agent Adapter

The highest-fidelity adapter. Spawns a real Cursor Agent process that discovers skills, reads files, executes tools, and produces multi-turn structured output. Slow but catches integration issues impossible to find with plain-llm.

### How It Works

1. Resolves the `agent` CLI binary (from `~/.local/share/cursor-agent/versions/`, SDK, or PATH)
2. Creates an isolated workspace with a copy of the skill directory (for parallel safety)
3. Spawns `agent -p --force --output-format stream-json --approve-mcps --trust --workspace <dir>`
4. Parses NDJSON events: `system`, `user`, `assistant`, `tool_call` (started/completed), `result`
5. Extracts tool calls with names, arguments, and results
6. Returns the full conversation including all tool interactions

### Cursor CLI Flags

| Flag | Purpose |
|---|---|
| `-p` | Pipe mode (stdin prompt, stdout structured output) |
| `--force` | Skip confirmation prompts |
| `--output-format stream-json` | NDJSON event stream |
| `--approve-mcps` | Auto-approve MCP tool calls |
| `--trust` | Trust the workspace |
| `--workspace <dir>` | Set the working directory |
| `--mode ask` | Read-only mode (when `readOnly: true`) |
| `--model <name>` | Override the model |

### Model Aliases

The adapter normalizes model names to Cursor's format:

| Input | Cursor Model |
|---|---|
| `claude-opus-4-6` | `opus-4.6` |
| `claude-sonnet-4-6` | `sonnet-4.6` |
| `claude-opus-4-6-thinking` | `opus-4.6-thinking` |
| `claude-sonnet-4-5-thinking` | `sonnet-4.5-thinking` |

### Configuration

```yaml
suites:
  - name: cursor-e2e-tools
    layer: llm
    adapter: cursor-cli
    skill_dir: .cursor/skills/my-skill
    defaults:
      timeout: 300000
    tests:
      - name: full tool workflow
        prompt: "Check the cluster health and create a dashboard"
        expected:
          tools: [elasticsearch_api, create_dashboard]
          response_contains: [dashboard, created]
        evaluators: [tool-selection, keywords, task-completion]
```

### Capabilities

| Capability | Supported |
|---|---|
| Tool calls | **Yes** — full MCP tool execution |
| Skill discovery | **Yes** — reads `.cursor/` directory |
| Multi-turn | Yes (full agent conversation) |
| Token tracking | Yes (from result event usage) |
| Concurrency | Limited (3 parallel default, serialized if sharing workspace) |
| Cost | Higher (full agent invocation per test) |
| File operations | Yes (read, write, edit, delete) |
| Shell commands | Yes |

### Workspace Isolation

When `skill_dir` is configured, the adapter creates an isolated workspace copy for each test to prevent file conflicts during parallel execution. A workspace pool can be pre-created for better performance:

```typescript
const pool = await createWorkspacePool(skillDir, baseWorkspace, 4);
```

### Retry Logic

The adapter retries on transient errors (e.g., CLI config race conditions):
- Default max retries: 3
- Default base delay: 2000ms with jitter
- Retryable pattern: `/cli-config\.json/`
- Remaining timeout is recalculated on each retry

### Tool Name Normalization

Cursor CLI uses internal tool call keys that get mapped to standard names:

| Internal Key | Normalized Name |
|---|---|
| `readToolCall` | `read_file` |
| `writeToolCall` | `write_file` |
| `shellToolCall` | `shell` |
| `editToolCall` | `edit_file` |
| `grepToolCall` | `grep` |
| `globToolCall` | `glob` |
| `mcpToolCall` | `mcp` |
| `searchToolCall` / `semSearchToolCall` | `semantic_search` |
| `listToolCall` / `listDirToolCall` | `list_dir` |
| `deleteToolCall` | `delete_file` |

### When to Use

- Final validation before merging (CI gate)
- Testing tool selection accuracy (does the agent pick the right MCP tools?)
- Testing skill discovery (does `.cursor/` config work correctly?)
- Testing multi-step workflows with file operations
- E2E testing of the full agent experience

---

## `claude-sdk` — Claude Agent SDK Adapter

Full e2e agent execution using `@anthropic-ai/claude-agent-sdk` ("Claude Code as a library"). Equivalent fidelity to `cursor-cli` but runs as a pure Node.js library — no external binary needed, containerizable for CI/Docker.

### How It Works

1. Dynamically imports `@anthropic-ai/claude-agent-sdk` (optional dependency)
2. Creates an isolated workspace (same infrastructure as cursor-cli)
3. Calls `query()` with `bypassPermissions` mode for autonomous execution
4. Streams events via async generator: `assistant`, `user`, `result`
5. Tracks tool calls via `PreToolUse`/`PostToolUse`/`PostToolUseFailure` hooks
6. Returns full conversation with tool interactions and token usage

### Configuration

```yaml
suites:
  - name: claude-e2e-tools
    layer: skill
    adapter: claude-sdk
    skill_dir: skills/security/alert-triage
    defaults:
      timeout: 300000
    tests:
      - name: full tool workflow
        prompt: "Triage the latest critical alerts"
        expected:
          tools: [search_alerts, get_alert_details]
        evaluators: [tool-selection, correctness]
```

### Capabilities

| Capability | Supported |
|---|---|
| Tool calls | **Yes** — full built-in tools (Bash, Read, Write, Edit, Glob, Grep) |
| Skill injection | Yes (via systemPrompt) |
| Multi-turn | Yes (full agent conversation) |
| Token tracking | Yes (from result event usage) |
| Concurrency | 5 parallel (workspace pool) |
| Cost | Moderate (per Anthropic API pricing) |
| File operations | Yes |
| Shell commands | Yes |
| Docker/CI | **Yes** — pure Node.js, no GUI/keychain |

### Tool Name Normalization

| Agent SDK Name | Normalized Name |
|---|---|
| `Bash` | `shell` |
| `Read` | `read_file` |
| `Write` | `write_file` |
| `Edit` | `edit_file` |
| `Glob` | `glob` |
| `Grep` | `grep` |
| `LS` | `list_dir` |

### When to Use

- CI/Docker-based eval pipelines (no desktop app dependency)
- Full e2e agent testing with tool call tracking
- Testing skill execution with file system access
- Cross-agent comparison (run same tests on claude-sdk AND cursor-cli)
- Production eval monitoring in containerized environments

---

## `mcp` — Direct MCP Client Adapter

Connects directly to the plugin's MCP server for integration and unit tests. No LLM involved — calls tools directly with specified arguments.

### When to Use

- Integration tests (call a tool, assert on the result)
- Unit tests (check tool registration, schema validation)
- Performance benchmarks (measure tool latency)

---

## Recommended Two-Adapter Workflow

### Phase 1: Iterate with `plain-llm`

```bash
npx cursor-plugin-evals run --suite "plain-llm-*" --verbose
```

- Fix all failures here first
- ~16s for a 10-test suite
- 4+ tests run in parallel

### Phase 2: Validate with `cursor-cli`

```bash
npx cursor-plugin-evals run --suite "cursor-e2e-*" --verbose
```

- Run after plain-llm passes
- ~444s for a 10-test suite (28x slower)
- 3 tests run in parallel

### Evaluator Strategy

| Adapter | Recommended Evaluators | Judge |
|---|---|---|
| `plain-llm` | `correctness`, `content-quality`, `keywords`, `similarity` | LLM (Azure GPT-4.1) |
| `cursor-cli` | `tool-selection`, `keywords`, `task-completion`, `workflow` | Keywords (CODE) — no API key needed |
| `claude-sdk` | `tool-selection`, `keywords`, `task-completion`, `correctness` | LLM or CODE |

Use LLM evaluators with `plain-llm` for richer signal during iteration. Use code-based evaluators with `cursor-cli`/`claude-sdk` for e2e runs. `claude-sdk` is preferred for CI/Docker since it doesn't require a desktop app binary.

---

## Performance Comparison

| Metric | `plain-llm` | `cursor-cli` | `claude-sdk` | `mcp` |
|---|---|---|---|---|
| Avg time per test | ~1.6s | ~44s | ~30-60s | <1s |
| Concurrency | 4+ parallel | 3 parallel | 5 parallel | Unlimited |
| Token usage per test | 150-775 | 500-7400 | 500-7400 | 0 |
| Requires external binary | No | Yes (Cursor CLI) | No (pure Node.js) | No |
| Requires LLM API key | Yes | No (uses Cursor subscription) | Yes (`ANTHROPIC_API_KEY`) | No |
| Tests tool calls | No | Yes | Yes | Yes (direct) |
| Tests skill discovery | No | Yes | Yes (via systemPrompt) | No |
| Docker/CI compatible | Yes | No (needs GUI) | **Yes** | Yes |
