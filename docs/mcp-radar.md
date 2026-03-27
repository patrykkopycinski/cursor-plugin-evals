# MCP-Radar Scoring

Per-tool metrics and MCP-specific benchmarking based on the [MCP-Radar research paper](https://arxiv.org/html/2505.16700v1).

## Metrics

### Per-Tool Precision / Recall / F1

Unlike global tool-selection F1, MCP-Radar computes metrics **per tool**:

```
Tool         | Precision | Recall | F1
-------------|-----------|--------|------
search       | 1.00      | 0.90   | 0.95
query        | 0.85      | 1.00   | 0.92
index        | 0.70      | 0.50   | 0.58  ← needs work
```

### Tool Hit Rate

Combined metric: correct tool selection AND correct arguments. A tool "hit" means both evaluators pass.

### Mean Reciprocal Rank (MRR)

Measures how early the correct tool appears in the agent's call sequence. MRR of 1.0 means the correct tool is always called first. MRR of 0.5 means it's typically second.

### Resource Efficiency

- **Token waste ratio**: Fraction of tokens beyond a 500-per-tool-call baseline
- **Avg tokens per tool call**: Raw token consumption per tool invocation

### Execution Speed

- **Avg time to first tool call**: Planning latency (how long before the agent starts acting)
- **Avg tool execution time**: Per-tool average latency
- **Total execution time**: End-to-end duration

## Usage

```typescript
import { computeMcpRadarReport } from 'cursor-plugin-evals';

const report = computeMcpRadarReport(testResults);

console.log(`Tool hit rate: ${(report.toolHitRate * 100).toFixed(1)}%`);
console.log(`MRR: ${report.meanReciprocalRank.toFixed(3)}`);
console.log(`Token waste: ${(report.tokenWasteRatio * 100).toFixed(1)}%`);
console.log(`Planning latency: ${report.avgTimeToFirstToolMs.toFixed(0)}ms`);

for (const tool of report.perToolMetrics) {
  console.log(`${tool.tool}: P=${tool.precision.toFixed(2)} R=${tool.recall.toFixed(2)} F1=${tool.f1.toFixed(2)}`);
}
```
