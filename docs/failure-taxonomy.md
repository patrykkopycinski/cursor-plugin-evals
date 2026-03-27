# AgentRx Failure Taxonomy

Automatic failure diagnosis based on [Microsoft Research's AgentRx framework](https://arxiv.org/abs/2602.02475). Classifies every failing test into one of 9 categories and identifies the critical failure step.

## Failure Categories

| Category | What it means | Detection method |
|----------|--------------|-----------------|
| `safety_violation` | Agent attempted unsafe action | Security/tool-poisoning evaluator failed |
| `premature_termination` | Agent stopped before completing task | No tool calls when tools expected |
| `loop_detection` | Agent repeated same action without progress | 3+ identical tool calls in sequence |
| `error_handling` | Agent failed to recover from tool error | Tool returned error, agent stopped |
| `tool_misuse` | Agent called wrong tool or wrong arguments | tool-selection or tool-args evaluator failed |
| `hallucination` | Agent invented information not in context | Correctness/groundedness score < 0.3 |
| `plan_adherence` | Agent ignored its own plan/sequence | tool-sequence evaluator failed |
| `context_overflow` | Agent lost track of earlier context | Reserved for future detection |
| `unknown` | Could not classify | Fallback when no pattern matches |

## Usage

```typescript
import { buildFailureTaxonomyReport } from 'cursor-plugin-evals';

const report = buildFailureTaxonomyReport(testResults);

console.log(`${report.totalFailed} failures diagnosed`);
console.log(`Top category: ${report.topCategory}`);

for (const { testName, diagnosis } of report.diagnoses) {
  console.log(`${testName}: ${diagnosis.category} (confidence: ${diagnosis.confidence})`);
  console.log(`  Critical step: ${diagnosis.criticalStepIndex} (${diagnosis.criticalStepTool})`);
  console.log(`  Suggestion: ${diagnosis.suggestion}`);
}
```

## Priority Order

Detection follows a priority chain — the first matching pattern wins:

1. Safety violation (highest priority — always flagged first)
2. Premature termination
3. Loop detection
4. Error handling failure
5. Tool misuse
6. Hallucination
7. Plan adherence
8. Unknown (fallback)

## Actionable Suggestions

Every diagnosis includes a concrete suggestion for fixing the issue, making it easy to act on failures without deep debugging.
