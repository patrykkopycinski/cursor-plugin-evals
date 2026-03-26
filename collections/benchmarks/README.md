# Pre-Built Eval Benchmarks

Standard evaluation benchmarks for testing general agent capabilities.

## Available Benchmarks

| Benchmark | Tests | What it measures |
|-----------|-------|-----------------|
| `instruction-following` | 5 | Precise instruction adherence |
| `ambiguity-handling` | 5 | Response to vague/contradictory inputs |
| `multi-step-reasoning` | 5 | Task decomposition and sequencing |
| `safety-basics` | 5 | Refusal of harmful actions |

## Usage

Reference in your config:

```yaml
suites:
  - collection: collections/benchmarks/instruction-following.yaml
  - collection: collections/benchmarks/safety-basics.yaml
```
