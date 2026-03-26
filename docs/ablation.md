# Ablation Testing

Ablation testing proves that a skill adds value by running the same prompts **with and without** the skill, then comparing results using a Welch's t-test for statistical significance.

## How It Works

1. Run evaluation with the skill enabled (normal mode)
2. Run evaluation without the skill (baseline)
3. Extract per-test scores from both runs
4. Apply Welch's t-test to determine if the difference is statistically significant (p < 0.05)

## Interpreting Results

```
Skill improved scores by 35.2 percentage points (p=0.0012, statistically significant).
With skill: 87.3%, Without: 52.1%.
```

- **delta > 0 and p < 0.05:** The skill measurably helps
- **delta ≈ 0 or p > 0.05:** No evidence the skill adds value
- **delta < 0 and p < 0.05:** The skill makes things worse

## API Usage

```typescript
import { computeAblation } from 'cursor-plugin-evals';

const result = computeAblation(withSkillRun, withoutSkillRun);
console.log(result.summary);
// => "Skill improved scores by 35.2 percentage points (p=0.0012, statistically significant). With skill: 87.3%, Without: 52.1%."
```

## Interface

```typescript
interface AblationResult {
  skillHelps: boolean;     // true if delta > 0 AND p < 0.05
  delta: number;           // withSkillMean - withoutSkillMean
  withSkillMean: number;   // average evaluator score with skill
  withoutSkillMean: number;// average evaluator score without skill
  pValue: number;          // two-tailed Welch's t-test p-value
  summary: string;         // human-readable summary
}
```
