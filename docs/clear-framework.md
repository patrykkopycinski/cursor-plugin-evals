# CLEAR Framework

Enterprise-grade multi-dimensional scoring based on the [CLEAR research paper](https://arxiv.org/html/2511.14136v1) (Cost, Latency, Efficacy, Assurance, Reliability).

## Why CLEAR?

Traditional eval frameworks optimize for accuracy alone. CLEAR shows that agents with the highest accuracy cost 4.4-10.8x more than Pareto-efficient alternatives. This framework scores your plugin across 5 dimensions to find the optimal quality/cost tradeoff.

## Dimensions

| Dimension | What it measures | Key metrics |
|-----------|-----------------|-------------|
| **Cost** | Economic efficiency | Cost-normalized accuracy (CNA), cost efficiency |
| **Latency** | Response time | Avg latency, SLA compliance rate, p95 |
| **Efficacy** | Task completion quality | Pass rate, avg evaluator score, task completion rate |
| **Assurance** | Safety and compliance | Security score, graceful failure rate, groundedness |
| **Reliability** | Consistency across runs | Score variance, per-trial success rate, pass^k |

## Usage

```typescript
import { computeClearReport } from 'cursor-plugin-evals';

const report = computeClearReport(runResult, { slaThresholdMs: 5000 });

console.log(`CLEAR Score: ${report.composite}/100 (${report.grade})`);
console.log(`Pareto efficient: ${report.paretoEfficient}`);
console.log(`Cost: ${report.cost.grade}, Latency: ${report.latency.grade}`);
console.log(`Efficacy: ${report.efficacy.grade}, Assurance: ${report.assurance.grade}`);
console.log(`Reliability: ${report.reliability.grade}`);
```

## Pareto Efficiency

A run is **Pareto efficient** when its cost-normalized accuracy (quality per dollar) is above the median. This helps identify when you're paying too much for marginal quality improvements.

## Grade Scale

Each dimension and the composite score use the same A-F scale:
- **A** (>= 0.9): Excellent
- **B** (>= 0.8): Good
- **C** (>= 0.7): Acceptable
- **D** (>= 0.6): Below average
- **F** (< 0.6): Poor
