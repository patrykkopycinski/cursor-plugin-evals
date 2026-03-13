# Regression Detection

Detect score regressions between evaluation runs using statistical hypothesis testing.

## CLI Usage

```bash
# Run evals and compare against a baseline fingerprint
cursor-plugin-evals regression --baseline <run-id>

# Custom significance level (default 0.05)
cursor-plugin-evals regression --baseline abc123 --alpha 0.01

# Filter to specific layers/suites, increase repetitions for statistical power
cursor-plugin-evals regression --baseline abc123 -l llm -r 5
```

## How Fingerprints Work

Each evaluation run produces a **fingerprint** — a JSON file mapping score vectors to test/evaluator keys:

```json
{
  "runId": "abc123",
  "timestamp": "2026-03-13T10:00:00.000Z",
  "scores": {
    "my-suite.basic-prompt.tool-selection": [0.9, 0.85, 0.95],
    "my-suite.basic-prompt.response-quality": [0.8, 0.75, 0.82]
  }
}
```

Keys follow the format `suite.test.evaluator`. Score arrays contain one value per repetition. Fingerprints are stored in `.cursor-plugin-evals/fingerprints/<run-id>.json`.

## Welch's t-Test

For each key present in both baseline and current fingerprints, the framework runs a **Welch's t-test** (two-sample, unequal variance) comparing the score distributions:

| Verdict | Condition |
|---------|-----------|
| **FAIL** | `p < alpha` AND current mean is lower than baseline |
| **PASS** | `p >= alpha` OR current mean is equal/higher |
| **INCONCLUSIVE** | Either sample has fewer than 3 observations |

The `--alpha` flag controls the significance level (default `0.05`). Lower alpha means fewer false positives but requires larger score drops to detect.

**Tip:** Use `--repeat 5` or higher to get enough samples for meaningful statistical tests.

## Programmatic API

```typescript
import {
  buildFingerprint, saveFingerprint, loadFingerprint,
  detectRegressions, welchTTest,
} from 'cursor-plugin-evals';

// After running evals, build and save a fingerprint
const fp = buildFingerprint(runResult.runId, allTestResults);
await saveFingerprint(fp);

// Later, compare against baseline
const baseline = await loadFingerprint('abc123');
const current = buildFingerprint('def456', newTestResults);
const regressions = detectRegressions(baseline!, current, 0.05);

for (const r of regressions) {
  console.log(`${r.key}: ${r.verdict} (Δ${r.delta.toFixed(3)}, p=${r.pValue.toFixed(4)})`);
}
```
