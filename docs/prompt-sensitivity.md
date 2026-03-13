# Prompt Sensitivity Analysis

Detect fragile LLM tests whose scores fluctuate significantly when prompts are rephrased with equivalent intent.

## CLI Usage

```bash
# Analyze a suite with 10 variants per test, 0.15 variance threshold
cursor-plugin-evals prompt-sensitivity --suite llm-e2e --variants 10 --threshold 0.15

# Fewer variants for a quick check
cursor-plugin-evals prompt-sensitivity -s my-llm-suite -n 3 --threshold 0.2

# Save report to file
cursor-plugin-evals prompt-sensitivity -s llm-e2e -n 5 -o sensitivity-report.txt
```

Exit code is non-zero if any test is classified as fragile.

## How Variants Are Generated

An LLM judge rephrases each test's prompt into N variants that preserve the same intent but use different wording and structure. For example:

- Original: `"List all available tools"`
- Variant 1: `"Show me what tools you have"`
- Variant 2: `"What tools can I use?"`
- Variant 3: `"Display the available tool set"`

The original prompt plus all variants are each run as a full evaluation, producing score vectors per evaluator.

## Variance Calculation

For each test, all evaluator scores across all variants (original + rephrased) are collected into a single array. The **population variance** is computed:

```
variance = Σ(score - mean)² / N
```

A test is classified as **fragile** if `variance > threshold` (default `0.15`).

High variance means the test's pass/fail outcome depends heavily on exact prompt wording rather than actual capability — a sign the test or the underlying tool behavior is brittle.

## Programmatic API

```typescript
import { loadConfig, analyzeSensitivity, formatSensitivityReport } from 'cursor-plugin-evals';

const config = loadConfig('./plugin-eval.yaml');
const results = await analyzeSensitivity(config, 'llm-e2e', 5, 0.15);

for (const r of results) {
  const status = r.isFragile ? 'FRAGILE' : 'STABLE';
  console.log(`${r.testName}: ${status} (variance: ${r.variance.toFixed(4)})`);
  for (const v of r.variants) {
    console.log(`  "${v.prompt.slice(0, 60)}..." → ${JSON.stringify(v.scores)}`);
  }
}

// Or use the built-in formatter
console.log(formatSensitivityReport(results, 0.15));
```

`SensitivityResult` fields:

| Field | Type | Description |
|-------|------|-------------|
| `testName` | `string` | Test name from the suite |
| `originalPrompt` | `string` | The original prompt text |
| `variants` | `Array<{prompt, scores}>` | Each variant's prompt and evaluator scores |
| `variance` | `number` | Computed variance across all scores |
| `isFragile` | `boolean` | `true` if variance exceeds threshold |
