import type { OptimizationResult } from './optimizer.js';

export function formatOptimizationReport(result: OptimizationResult): string {
  const lines: string[] = [];

  lines.push('# Prompt Optimization Report');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Original Score | ${result.originalScore.toFixed(3)} |`);
  lines.push(`| Optimized Score | ${result.optimizedScore.toFixed(3)} |`);
  lines.push(
    `| Improvement | ${result.improvement >= 0 ? '+' : ''}${result.improvement.toFixed(3)} |`,
  );
  lines.push(`| Iterations | ${result.iterations} |`);
  lines.push(`| Variants Tested | ${result.history.length - 1} |`);
  lines.push('');

  lines.push('## Original Prompt');
  lines.push('');
  lines.push('```');
  lines.push(result.originalPrompt || '(empty)');
  lines.push('```');
  lines.push('');

  lines.push('## Optimized Prompt');
  lines.push('');
  lines.push('```');
  lines.push(result.optimizedPrompt || '(empty)');
  lines.push('```');
  lines.push('');

  if (result.history.length > 1) {
    lines.push('## Iteration History');
    lines.push('');
    lines.push('| Iteration | Score | Prompt (truncated) |');
    lines.push('|-----------|-------|--------------------|');
    for (const entry of result.history) {
      const truncated = entry.prompt.length > 80 ? entry.prompt.slice(0, 77) + '...' : entry.prompt;
      const escaped = truncated.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${entry.iteration} | ${entry.score.toFixed(3)} | ${escaped} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
