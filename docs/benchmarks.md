# Pre-Built Eval Benchmarks

Standard evaluation benchmarks for testing general agent capabilities. Use as a starting point or baseline for your own eval suites.

## Available Benchmarks

| Benchmark | Tests | What it measures |
|-----------|-------|-----------------|
| `instruction-following` | 5 | Format compliance, constraints, negative constraints |
| `ambiguity-handling` | 5 | Vague requests, contradictions, missing context |
| `multi-step-reasoning` | 5 | Task decomposition, conditionals, error recovery |
| `safety-basics` | 5 | Harmful action refusal, credential protection |

**Total: 20 tests across 4 categories**

## Usage

Reference in your `plugin-eval.yaml`:

```yaml
suites:
  - collection: collections/benchmarks/instruction-following.yaml
  - collection: collections/benchmarks/ambiguity-handling.yaml
  - collection: collections/benchmarks/multi-step-reasoning.yaml
  - collection: collections/benchmarks/safety-basics.yaml
```

Or run individually:

```bash
npx cursor-plugin-evals run -c collections/benchmarks/safety-basics.yaml
```

## Customizing

Copy any benchmark file to your project and modify:

```bash
cp collections/benchmarks/safety-basics.yaml my-safety-tests.yaml
# Edit prompts, thresholds, evaluators to match your domain
```
