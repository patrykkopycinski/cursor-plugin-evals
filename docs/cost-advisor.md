# Cost Optimization

Analyze multi-model evaluation data to find the cheapest model that meets your quality threshold.

## How It Works

1. Run the same suite against multiple models.
2. The cost advisor collects per-test scores and token usage.
3. For each test, it finds the cheapest model whose score meets the threshold.
4. It produces a report with per-test recommendations and total savings.

Cost is computed from token usage using a built-in pricing catalog that covers OpenAI, Anthropic, and Azure OpenAI models.

## CLI Usage

```bash
# Compare costs across 3 models (threshold: 0.8)
cursor-plugin-evals cost-report \
  -m gpt-4o -m gpt-4o-mini -m claude-sonnet-4-20250514 \
  --threshold 0.8

# Lower threshold for cost-sensitive environments
cursor-plugin-evals cost-report \
  -m gpt-4o -m gpt-4o-mini \
  --threshold 0.7 \
  -o cost-report.txt

# Filter to specific suites
cursor-plugin-evals cost-report \
  -m gpt-4o -m gpt-4o-mini \
  -s llm-e2e \
  --threshold 0.8
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-m, --model <models...>` | *required (≥2)* | Models to compare |
| `--threshold <n>` | `0.8` | Minimum quality score |
| `-l, --layer <layers...>` | — | Filter layers |
| `-s, --suite <suites...>` | — | Filter suites |
| `-o, --output <path>` | — | Write report to file |

## Reading the Report

```
Cost Optimization Report
════════════════════════

Current total:   $1.24
Optimized total: $0.38
Savings:         $0.86 (69%)

Model Breakdown:
  gpt-4o:        12 tests, $0.96
  gpt-4o-mini:    8 tests, $0.18
  claude-sonnet-4-20250514:  12 tests, $0.48

Recommendations:
  llm-e2e/basic-search
    Current:     gpt-4o ($0.08, score: 0.95)
    Recommended: gpt-4o-mini ($0.01, score: 0.88) — saves 87%

  llm-e2e/complex-workflow
    Current:     gpt-4o ($0.12, score: 0.92)
    Recommended: gpt-4o (keep) — no cheaper model meets threshold
```

For each test, the report recommends the cheapest model that:
- Scored ≥ threshold on that test
- Has token usage data available

## Programmatic API

```typescript
import { analyzeCosts, formatCostReport } from 'cursor-plugin-evals';
import type { CostReport, CostRecommendation } from 'cursor-plugin-evals';

const comparisonData = [
  { testName: 'basic-search', model: 'gpt-4o', score: 0.95, tokenUsage: { input: 500, output: 200 } },
  { testName: 'basic-search', model: 'gpt-4o-mini', score: 0.88, tokenUsage: { input: 500, output: 180 } },
  { testName: 'complex-workflow', model: 'gpt-4o', score: 0.92, tokenUsage: { input: 2000, output: 800 } },
  { testName: 'complex-workflow', model: 'gpt-4o-mini', score: 0.65, tokenUsage: { input: 2000, output: 750 } },
];

const report: CostReport = analyzeCosts(comparisonData, 0.8);

console.log(`Current cost:   $${report.totalCurrentCost.toFixed(2)}`);
console.log(`Optimized cost: $${report.totalOptimizedCost.toFixed(2)}`);
console.log(`Savings:        ${report.totalSavingsPercent.toFixed(0)}%`);

for (const rec of report.recommendations) {
  console.log(`${rec.testName}: ${rec.currentModel} → ${rec.recommendedModel} (saves ${rec.savingsPercent.toFixed(0)}%)`);
}

// Format for display
console.log(formatCostReport(report));
```

## See Also

- [LLM Eval Layer](./layers/llm.md)
- [Configuration Reference](./configuration.md)
- [CI/CD Integration](./ci-cd.md)
