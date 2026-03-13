import chalk from 'chalk';
import type { ConformanceReport, ConformanceCategory } from './types.js';

const TIER_BADGES: Record<1 | 2 | 3, string> = {
  1: chalk.green.bold(' TIER 1 — Full Compliance '),
  2: chalk.yellow.bold(' TIER 2 — Partial Compliance '),
  3: chalk.red.bold(' TIER 3 — Minimal Compliance '),
};

const CATEGORY_LABELS: Record<ConformanceCategory, string> = {
  initialization: 'Initialization',
  'tool-listing': 'Tool Listing',
  'tool-execution': 'Tool Execution',
  'resource-listing': 'Resource Listing',
  'resource-reading': 'Resource Reading',
  'prompt-listing': 'Prompt Listing',
  'prompt-getting': 'Prompt Getting',
  'error-handling': 'Error Handling',
  cancellation: 'Cancellation',
  'capability-negotiation': 'Capability Negotiation',
};

export function formatConformanceReport(report: ConformanceReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold(`━━━ MCP Conformance: ${report.serverName} ━━━`));
  lines.push('');
  lines.push(`  ${TIER_BADGES[report.tier]}`);
  lines.push('');

  const categories = Object.keys(report.byCategory) as ConformanceCategory[];

  for (const cat of categories) {
    const catResults = report.results.filter((r) => r.check.category === cat);
    if (catResults.length === 0) continue;

    const stats = report.byCategory[cat];
    const label = CATEGORY_LABELS[cat] ?? cat;
    const catIcon = stats.passed === stats.total ? chalk.green('✓') : chalk.red('✗');
    lines.push(`  ${catIcon} ${chalk.bold(label)} (${stats.passed}/${stats.total})`);

    for (const r of catResults) {
      if (r.skipped) {
        lines.push(`    ${chalk.yellow('○')} ${r.check.name} ${chalk.gray('— skipped')}`);
      } else if (r.passed) {
        lines.push(
          `    ${chalk.green('✓')} ${r.check.name} ${chalk.gray(`(${r.durationMs.toFixed(0)}ms)`)}`,
        );
      } else {
        lines.push(
          `    ${chalk.red('✗')} ${r.check.name} ${chalk.gray(`(${r.durationMs.toFixed(0)}ms)`)}`,
        );
        lines.push(`      ${chalk.gray(r.message)}`);
      }
    }
    lines.push('');
  }

  lines.push(chalk.gray('  ────────────────────────────────────────'));
  const rate = (report.passRate * 100).toFixed(1);
  const color = report.failed === 0 ? chalk.green : chalk.red;
  const parts = [`${report.passed} passed`, `${report.failed} failed`];
  if (report.skipped > 0) parts.push(`${report.skipped} skipped`);
  lines.push(`  ${color(`${rate}% pass rate`)} — ${parts.join(', ')}, ${report.totalChecks} total`);
  lines.push('');

  return lines.join('\n');
}
