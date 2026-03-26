## Option 3: cursor-plugin-evals

[cursor-plugin-evals](https://github.com/patrykkopycinski/cursor-plugin-evals) is an open source evaluation and testing framework (MIT license) for AI agent plugins that expose skills and MCP (Model Context Protocol) tools. Written in TypeScript, it provides multi-layered test execution, 30 built-in evaluators (both deterministic and LLM-as-judge), multiple execution adapters, and native CI integration with composite quality gates.

Like Skillgrade, cursor-plugin-evals evaluates skills in the [Anthropic agent skill format](https://agentskills.io/home) — the SKILL.md files that guide an LLM in executing specific tasks within Cursor, Claude Code, or similar AI coding assistants. It is designed for CI execution and provides richer evaluation dimensions than a flat task/grader model.

### Key Differentiators from Skillgrade

**Multi-layered test architecture.** Instead of a flat list of tasks, tests are organized into six layers that run cheapest-first:

| Layer | Purpose | RFC Mapping |
| :---- | :---- | :---- |
| **static** | Validates SKILL.md frontmatter (name, description, triggers), content quality, cross-references — no LLM calls needed | Deterministic outcome verification |
| **unit** | Validates MCP tool registration, schema correctness, conditional availability | Deterministic outcome verification |
| **integration** | Executes MCP tool calls with assertions on response structure and content | Integration testing |
| **llm** | Agent loop with natural language prompts, tool selection, multi-turn conversations | Outcome verification (LLM-as-Judge) + Accuracy |
| **performance** | Repeated execution with p50/p95/p99 latency thresholds and token tracking | Efficiency |
| **skill** | Dataset-driven evaluation: loads per-skill golden examples, runs through configurable adapters | Accuracy (golden dataset) |

This layered approach means cheap deterministic checks (static, unit) run first, and expensive LLM-based evaluations only run on code that has already passed structural validation.

**Two-adapter strategy for cost control.** A key differentiator is decoupling fast iteration from full end-to-end validation:

| Phase | Adapter | Speed | Cost | Use Case |
| :---- | :---- | :---- | :---- | :---- |
| **Iterate** | `plain-llm` | ~10s/test | Low (single API call) | Writing tests, tuning prompts, development CI |
| **Validate** | `cursor-cli` | ~125s/test | Higher (full agent loop) | Pre-release validation, nightly CI |

The `plain-llm` adapter injects the skill content as a system prompt and makes a single LLM API call — no agent loop, no tool spawning, no workspace setup. This is approximately **28x faster** than a full agent-based evaluation. For a 15-task evaluation suite:

* **plain-llm**: ~$0.03–0.05 per run (estimated, using Claude Sonnet via Bedrock)
* **cursor-cli**: ~$0.70–1.00 per run (full agent with tool use)

Daily development CI can use `plain-llm` exclusively, with `cursor-cli` reserved for merge gates or nightly runs. This directly addresses the cost concern identified in Option 2, where ~$0.8 per evaluation was noted as potentially prohibitive.

**30 built-in evaluators** spanning all four RFC evaluation dimensions:

| RFC Dimension | Evaluators |
| :---- | :---- |
| **Outcome verification** (deterministic) | `keywords`, `tool-selection`, `tool-args`, `tool-sequence`, `mcp-protocol`, `esql-execution`, `esql-pattern`, `esql-result` |
| **Outcome verification** (LLM-as-Judge) | `correctness`, `groundedness`, `g-eval`, `criteria`, `task-completion`, `trajectory` |
| **Accuracy** | `correctness` (with golden dataset), `similarity`, `context-faithfulness` |
| **Execution-based** | `esql-execution` (run query against live ES), `esql-pattern` (structural pattern matching with equivalence classes), `esql-result` (column overlap + row count similarity vs golden query) |
| **LLM Baseline** | Run same tests with `plain-llm` adapter (skill injected) vs without (no skill) and compare scores |
| **Efficiency** | `token-usage` evaluator + performance layer with p50/p95/p99 thresholds |
| **Security** (bonus) | `security`, `tool-poisoning`, `resistance` + red-team module |

**Execution-based ES|QL evaluators.** A recent addition inspired by the [agent-skills-sandbox evaluation harness](https://github.com/elastic/agent-skills-sandbox/tree/main/tests/elasticsearch/elasticsearch-esql) provides three-axis deterministic scoring for ES|QL queries — no LLM judge needed:

| Evaluator | What it checks | Scoring |
| :---- | :---- | :---- |
| `esql-execution` | Does the generated query execute against a live ES cluster? | `1.0` = success, `0.4` = valid syntax but wrong index (`index_not_found`), `0` = error |
| `esql-pattern` | Does the query use the expected ES|QL commands? | Proportional match with equivalence classes (`LOOKUP JOIN` ≈ `ENRICH`, `DISSECT` ≈ `GROK`) |
| `esql-result` | Do the query results match the golden query's results? | Average of column overlap + row count similarity |

This is stronger than LLM-as-judge for ES|QL because it catches queries that look right but don't execute, is fully deterministic and reproducible (no judge variance), and tests functional equivalence rather than textual similarity.

### Example: ES|QL skill evaluation

The following `plugin-eval.yaml` evaluates the *elasticsearch-esql* skill across the same three tasks used in the Skillgrade example (Option 2), demonstrating deterministic, execution-based, and LLM-judge evaluation.

**Execution-based evaluation (runs queries against live Elasticsearch — not available in Skillgrade):**

```yaml
plugin:
  name: elasticsearch-esql-skill
  dir: skills/elasticsearch/elasticsearch-esql

defaults:
  judge_model: gpt-4.1
  timeout: 180
  thresholds:
    esUrl: "${ELASTICSEARCH_URL}"

suites:
  - name: esql-execution-scoring
    layer: llm
    adapter: plain-llm
    evaluators:
      - esql-execution    # Does it run? (1.0/0.4/0)
      - esql-pattern      # Does it use the right commands? (0-1.0)
      - esql-result       # Do the results match the golden? (0-1.0)
    tests:
      - name: basic-query-accuracy
        prompt: |
          There is an Elasticsearch index called `logs-test` that contains
          application logs. Retrieve the 10 most recent log entries showing
          @timestamp, level, and message, sorted by @timestamp descending.
          Write only the ES|QL query.
        expected:
          response_contains:      # Used by esql-pattern as criteria
            - "KEEP"
            - "SORT.*DESC"
            - "LIMIT 10"
          esql_golden: |          # Used by esql-result for result comparison
            FROM logs-test
            | KEEP @timestamp, level, message
            | SORT @timestamp DESC
            | LIMIT 10
        repetitions: 5

      - name: aggregation
        prompt: |
          Write an ES|QL query that counts log entries per level from the
          `logs-test` index and returns the results sorted by count
          descending.
        expected:
          response_contains:
            - "STATS"
            - "BY"
            - "SORT.*DESC"
          esql_golden: |
            FROM logs-test
            | STATS count = COUNT(*) BY level
            | SORT count DESC
        repetitions: 5

      - name: schema-discovery
        prompt: |
          Write an ES|QL query to discover all available fields and their
          types in the `logs-test` index.
        expected:
          response_contains:
            - "FROM"
            - "logs-test"
          esql_golden: |
            FROM logs-test
            | LIMIT 0
        repetitions: 5
```

**Deterministic keyword checks (equivalent to Skillgrade's deterministic grader — no live cluster needed):**

```yaml
  - name: esql-deterministic
    layer: llm
    adapter: plain-llm
    evaluators:
      - keywords
    tests:
      - name: basic-query
        prompt: |
          There is an Elasticsearch index called `logs-test` that contains
          application logs. Retrieve the 10 most recent log entries from it,
          showing the @timestamp, level, and message fields, sorted by
          @timestamp descending. Write only the ES|QL query, nothing else.
        expected:
          response_contains:
            - "FROM"
            - "logs-test"
            - "LIMIT"
            - "SORT"
        repetitions: 5

      - name: aggregation
        prompt: |
          Write an ES|QL query that counts log entries per level from the
          `logs-test` index and returns the results sorted by count
          descending.
        expected:
          response_contains:
            - "FROM"
            - "logs-test"
            - "STATS"
            - "BY"
        repetitions: 5

      - name: schema-discovery
        prompt: |
          Write an ES|QL query to discover all available fields and their
          types in the `logs-test` index.
        expected:
          response_contains:
            - "FROM"
            - "logs-test"
        repetitions: 5
```

**LLM-as-Judge for qualitative assessment (equivalent to Skillgrade's llm_rubric grader):**

```yaml
  - name: esql-accuracy
    layer: llm
    adapter: plain-llm
    evaluators:
      - correctness
      - content-quality
    tests:
      - name: basic-query-accuracy
        prompt: |
          There is an Elasticsearch index called `logs-test` that contains
          application logs. Retrieve the 10 most recent log entries showing
          @timestamp, level, and message, sorted by @timestamp descending.
          Write only the ES|QL query.
        expected:
          esql_golden: |
            FROM logs-test
            | KEEP @timestamp, level, message
            | SORT @timestamp DESC
            | LIMIT 10
        repetitions: 5
```

**Static validation (no LLM cost — not available in Skillgrade):**

```yaml
  - name: esql-skill-structure
    layer: static
    tests:
      - name: skill-frontmatter
        type: skill_frontmatter
        description: "SKILL.md has required fields (name, description, triggers)"
      - name: skill-content-quality
        type: skill_content_quality
        description: "Skill body contains actionable instructions"
```

### CI integration

cursor-plugin-evals provides composite CI gates that go beyond a single pass/fail threshold:

```yaml
ci:
  score:
    avg: 0.85
    min: 0.60
  first_try_pass_rate: 0.80
  required_pass:
    - esql-skill-structure
    - esql-deterministic
    - esql-execution-scoring
```

The `first_try_pass_rate` metric maps directly to the RFC's **pass@1** concept. Combined with `repetitions`, this provides the probabilistic testing framework the RFC describes:

* **pass@k** is approximated by setting `repetitions: k` and checking if any trial passes
* **pass^k** can be derived from the per-test pass rate across k repetitions

A GitHub Actions integration:

```yaml
- name: Evaluate ES|QL skill
  run: |
    cd skills/elasticsearch/elasticsearch-esql
    npx cursor-plugin-evals run --ci --reporter junit --output results/
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    ELASTICSEARCH_URL: ${{ secrets.ELASTICSEARCH_URL }}
    ES_API_KEY: ${{ secrets.ES_API_KEY }}

- name: Publish test results
  uses: dorny/test-reporter@v1
  if: always()
  with:
    name: Skill Eval Results
    path: results/*.xml
    reporter: java-junit
```

Running the evaluation:

```bash
# Fast iteration during development (plain-llm only, ~15s total)
npx cursor-plugin-evals run --suite esql-deterministic --verbose

# Execution-based scoring against live ES (deterministic, no LLM judge)
npx cursor-plugin-evals run --suite esql-execution-scoring --verbose

# Full CI run with quality gates
npx cursor-plugin-evals run --ci
```

### Reporting

cursor-plugin-evals supports multiple output formats: terminal (default), JSON, HTML dashboard, JUnit XML (for CI integration), TAP, and Markdown — providing flexibility for different consumption contexts (developer terminal, CI pipelines, pull request comments).

### Note on Agent Builder skills vs Anthropic-format skills

It is important to distinguish between **Anthropic-format skills (SKILL.md)** — the markdown files this RFC targets — and **Agent Builder skills**, which are server-side TypeScript registrations that run within Kibana's inference orchestration. These are fundamentally different systems:

| Aspect | Anthropic Skills (SKILL.md) | Agent Builder Skills |
| :---- | :---- | :---- |
| **Format** | Markdown file with frontmatter | TypeScript registration + Zod tool schemas |
| **Execution** | Client-side by user's AI assistant (Claude, Cursor) | Server-side by Kibana inference |
| **Tools** | MCP tools (optional) | Agent Builder tool registry (esClient, savedObjectsClient, plugin services) |
| **Runtime** | IDE / CLI | Kibana server |
| **Evaluation framework** | Skillgrade, cursor-plugin-evals | @kbn/evals |

cursor-plugin-evals and Skillgrade evaluate **Anthropic-format SKILL.md files** by injecting them into an LLM and testing the output — which is how these skills are actually consumed by Cursor and Claude.

For skills that are implemented as **Agent Builder skills** within Kibana, the [`@kbn/evals`](https://github.com/elastic/kibana/tree/main/x-pack/platform/packages/shared/kbn-evals) framework is the appropriate evaluation tool. It provides Elastic-native persistence (results in Elasticsearch), trace-first evaluators (extracting signals from OpenTelemetry spans), multi-model matrix testing (same suite across all configured Kibana inference connectors), and Buildkite CI integration. The two frameworks are complementary: cursor-plugin-evals validates a skill's behavior as a portable SKILL.md file, while @kbn/evals validates the skill's integration within Kibana's Agent Builder.

### Comparison of all three options

| Criterion | Option 1 (skill-creator) | Option 2 (Skillgrade) | Option 3 (cursor-plugin-evals) |
| :---- | :---- | :---- | :---- |
| **Type** | LLM-driven skill | CLI framework | CLI framework + programmatic API |
| **License** | Anthropic | MIT | MIT |
| **Grader types** | LLM-only | 2 (deterministic bash + LLM rubric) | 35 evaluators (16 deterministic + 14 LLM-judge + multi-judge + script) |
| **Execution-based evaluators** | No | No | Yes — ES|QL queries executed against live ES, pattern matching with equivalence classes, result set comparison |
| **Test structure** | Flat | Flat (tasks in single YAML) | 6 layers (static → unit → integration → llm → performance → skill) |
| **CI integration** | Limited | `--ci` flag + threshold | `--ci` with composite gates (score, pass rate, required suites, latency) |
| **pass@k / pass^k** | Via skill logic | Built-in presets (smoke/reliable/regression) | `repetitions` + `first_try_pass_rate` gate |
| **Cost control** | Expensive (full LLM loop) | ~$0.8/eval | Two-adapter: ~$0.03/eval (plain-llm) or ~$0.8/eval (cursor-cli) |
| **MCP tool testing** | No | No | Native (spawns MCP server, calls tools) |
| **Performance benchmarks** | No | Basic timing | p50/p95/p99 thresholds + token tracking |
| **Security testing** | No | No | Red-team, prompt injection, tool poisoning |
| **Docker isolation** | No | Yes (provider: docker) | Via docker-compose infrastructure |
| **Reporting formats** | In-conversation | CLI + UI | Terminal, JSON, HTML, JUnit, TAP, Markdown |
| **SKILL.md validation** | Implicit | No | Static layer (frontmatter, content quality, cross-references) |
| **Best suited for** | Individual skill developers | Lightweight CI testing | Full lifecycle: dev iteration → CI → security audit |

---

## Proposal (revised)

Based on our evaluation of tools and frameworks, we propose a three-tier approach for skill creation and testing:

* **Option 1: The `skill-creator` tool** is best suited as a personal utility for skill developers to write and test skills locally.
* **Option 2: The `skillgrade` framework** is a lightweight choice for Continuous Integration testing, providing deterministic and LLM-rubric graders with minimal setup. Its simplicity makes it a good starting point for teams adopting skill evaluation.
* **Option 3: The `cursor-plugin-evals` framework** is the recommended choice for comprehensive CI testing at scale. Its two-adapter strategy addresses the cost concern (~$0.03/eval with plain-llm vs ~$0.8/eval with full agent), while its multi-layered architecture, 35 evaluators (including execution-based ES|QL evaluators), and MCP tool testing provide deeper coverage as skill complexity grows.

For skills that are ported to or implemented as **Agent Builder skills** within Kibana, `@kbn/evals` is the appropriate evaluation framework for server-side validation and should be used in conjunction with the above options.

The primary next step is to validate cost and effectiveness by implementing a dedicated GitHub Action in `agent-skill-sandbox`. We recommend:

1. Start with **cursor-plugin-evals** using the `plain-llm` adapter to establish a cost baseline (~$0.03–0.05 per run).
2. Compare results with **Skillgrade** on the same ES|QL skill tasks to evaluate coverage and signal quality.
3. Enable execution-based ES|QL evaluators (`esql-execution`, `esql-pattern`, `esql-result`) for tasks where a live Elasticsearch cluster is available — these provide deterministic, reproducible scoring without LLM judge variance.
4. Add `cursor-cli` adapter runs as a nightly gate once the evaluation suite is stable.

At this time, it is important that we do not deploy this evaluation system in our public repository.
