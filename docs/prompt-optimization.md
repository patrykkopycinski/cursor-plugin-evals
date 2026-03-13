# Prompt Optimization

Iteratively improve system prompts and tool descriptions using a hill-climbing algorithm that maximizes evaluator scores.

## How It Works

1. The optimizer takes a suite with existing prompts and a target evaluator.
2. It runs the suite to get a baseline score.
3. An LLM generates N variant prompts based on the current best.
4. Each variant is evaluated by running the full suite.
5. The highest-scoring variant becomes the new baseline.
6. Repeat until the target score is reached or max iterations is exhausted.

This is a greedy hill-climbing approach — each iteration keeps the best variant and discards the rest.

## CLI Usage

```bash
# Optimize prompts in a suite to maximize tool-selection score
cursor-plugin-evals optimize -s llm-e2e -e tool-selection

# More iterations and variants
cursor-plugin-evals optimize -s llm-e2e -e response-quality \
  -i 10 -n 5 --target-score 0.95

# Save the optimization report
cursor-plugin-evals optimize -s llm-e2e -o optimization-report.txt
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-s, --suite <name>` | *required* | Suite name to optimize |
| `-e, --evaluator <name>` | `tool-selection` | Target evaluator to maximize |
| `-i, --iterations <n>` | `5` | Maximum optimization iterations |
| `-n, --variants <n>` | `3` | Variants generated per iteration |
| `--target-score <n>` | `0.95` | Stop when this score is reached |
| `-o, --output <path>` | — | Write report to file |

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `suite` | string | *required* | Suite name from config |
| `targetEvaluator` | string | `tool-selection` | Evaluator to maximize |
| `maxIterations` | number | `5` | Max rounds of improvement |
| `variantsPerIteration` | number | `3` | Variants per round |
| `targetScore` | number | `0.95` | Early stop threshold |

## Interpreting Results

The report shows the optimization trajectory:

```
Prompt Optimization Report
══════════════════════════

Original score:  0.720
Optimized score: 0.945 (+0.225)
Iterations:      4

History:
  Iteration 1: 0.780 (+0.060)
  Iteration 2: 0.850 (+0.070)
  Iteration 3: 0.945 (+0.095)
  Iteration 4: 0.945 (+0.000) — converged

Original prompt:
  "Search for documents"

Optimized prompt:
  "Search the Elasticsearch cluster for documents matching
   the user's query. Use the elasticsearch_api tool with
   method GET and the _search endpoint."
```

When the score stops improving between iterations, the optimizer declares convergence.

## Programmatic API

```typescript
import { loadConfig, optimizePrompt, formatOptimizationReport } from 'cursor-plugin-evals';
import type { OptimizationConfig, OptimizationResult } from 'cursor-plugin-evals';

const config = loadConfig('./plugin-eval.yaml');

const optConfig: OptimizationConfig = {
  suite: 'llm-e2e',
  targetEvaluator: 'tool-selection',
  maxIterations: 5,
  variantsPerIteration: 3,
  targetScore: 0.95,
};

const result: OptimizationResult = await optimizePrompt(config, optConfig);

console.log(`Original:  ${result.originalScore.toFixed(3)}`);
console.log(`Optimized: ${result.optimizedScore.toFixed(3)}`);
console.log(`Improvement: +${result.improvement.toFixed(3)} over ${result.iterations} iterations`);

// Full history
for (const h of result.history) {
  console.log(`  Iteration ${h.iteration}: ${h.score.toFixed(3)} — "${h.prompt.slice(0, 60)}..."`);
}

// Formatted report
console.log(formatOptimizationReport(result));
```

## See Also

- [Prompt Sensitivity](./prompt-sensitivity.md)
- [LLM Eval Layer](./layers/llm.md)
- [Evaluators](./evaluators.md)
