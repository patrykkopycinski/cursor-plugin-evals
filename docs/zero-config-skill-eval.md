# Zero-Config Skill Eval

Auto-generate a complete eval.yaml from your SKILL.md with a single command.

## Quick Start

```bash
# Generate eval.yaml from SKILL.md
cursor-plugin-evals skill-eval-init --skill-dir ./my-skill

# Run the generated eval
cursor-plugin-evals skill-eval --skill-dir ./my-skill

# Run with AI-powered optimization
cursor-plugin-evals skill-eval --skill-dir ./my-skill --optimize
```

## How It Works

1. **Analyze** — LLM reads your SKILL.md and extracts a structured profile (capabilities, tools, complexity, domain terms)
2. **Generate** — LLM produces 5-8 diverse test cases (happy-path, edge-case, boundary, negative) with auto-selected evaluators and thresholds
3. **Materialize** — Tests are written to `eval.yaml` with inline comments for easy customization
4. **Run** — Standard `skill-eval` execution with the generated config
5. **Recommend** — After every run, a two-phase recommendation engine suggests improvements

## Commands

### `skill-eval-init`

```bash
cursor-plugin-evals skill-eval-init --skill-dir <path> [--force] [--model <model>]
```

| Option | Description |
|--------|-------------|
| `--skill-dir` | Directory containing SKILL.md (required) |
| `--force` | Overwrite existing eval.yaml |
| `--model` | Override LLM model for generation |

### `skill-eval` (enhanced)

```bash
cursor-plugin-evals skill-eval --skill-dir <path> [--optimize] [--no-llm-recommendations]
```

| Option | Description |
|--------|-------------|
| `--optimize` | Apply AI recommendations to eval.yaml after run |
| `--no-llm-recommendations` | Skip LLM-powered recommendations (deterministic only, for CI) |

## Evaluator Auto-Selection

Based on your skill's profile, evaluators are automatically chosen:

| Condition | Evaluator Added |
|-----------|----------------|
| Always | `correctness` |
| Has domain keywords | `keywords` |
| Produces code/queries | `script` |
| Invokes tools | `tool-selection` |
| Complex skill | `plan-quality` |

## Recommendations

After every run, the engine provides two phases of recommendations:

**Phase 1 — Deterministic (free, instant):**
- All tests score 1.0 → "Tests may be too easy"
- Low evaluator scores → Threshold adjustment suggestions
- < 5 tests → "Add more tests"
- 100% pass with 1 repetition → "Add repetitions for pass@k metrics"

**Phase 2 — LLM-powered (context-aware):**
- Coverage gap detection ("Your skill doesn't test DISSECT patterns")
- Concrete new test suggestions with prompts
- Evaluator recommendations
- Threshold tuning

## Cost

| Operation | LLM Calls | Approximate Cost |
|-----------|-----------|-----------------|
| `skill-eval-init` | 2 (analyze + generate) | ~$0.02 |
| `skill-eval` | 1 (recommendations) | ~$0.01 |
| `--optimize` | Same as skill-eval | ~$0.01 |
| `--no-llm-recommendations` | 0 | $0.00 |
