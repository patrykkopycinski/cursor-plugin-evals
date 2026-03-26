# Trial Metrics: pass@k and pass^k

When running evaluations with multiple repetitions (`repetitions: N` or `--repeat N`), the framework computes probabilistic trial metrics based on [Anthropic's agent evaluation methodology](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

## Metrics

- **Per-trial success rate (p):** The average probability that a single test passes on any given trial.
- **pass@k:** `1 - (1-p)^k` — the probability that at least one of k trials succeeds. Increases with k.
- **pass^k:** `p^k` — the probability that all k trials succeed. Decreases with k.

At k=1, both metrics equal p. As k grows, pass@k approaches 100% while pass^k approaches 0%.

## Named Presets

Use `--preset` for standard trial counts:

| Preset | Trials | Use Case |
|--------|--------|----------|
| `--preset smoke` | 5 | Fast feedback during development |
| `--preset reliable` | 20 | Balanced CI validation |
| `--preset regression` | 50 | Comprehensive pre-release |

## Example Output

```
  Trial Metrics

  Per-trial success rate: 85.0%

  k   pass@k   pass^k
  1   85.0%    85.0%
  5   99.9%    44.4%
  10  100.0%   19.7%
```

## Configuration

```yaml
defaults:
  repetitions: 5
```

Or via CLI: `--repeat 20` or `--preset reliable`.
