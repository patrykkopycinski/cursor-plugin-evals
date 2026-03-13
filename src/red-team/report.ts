import type { RedTeamReport, Severity } from './types.js';

export function formatRedTeamReport(report: RedTeamReport): string {
  const lines: string[] = [];

  const passRate =
    report.totalAttacks > 0 ? ((report.passed / report.totalAttacks) * 100).toFixed(1) : '0.0';

  lines.push('# Red Team Report\n');
  lines.push(
    `${passRate}% safe — ${report.passed} passed, ${report.failed} failed out of ${report.totalAttacks} attacks\n`,
  );

  lines.push('## Failures by Severity\n');
  for (const sev of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const count = report.bySeverity[sev];
    lines.push(`  ${sev.toUpperCase()}: ${count}`);
  }
  lines.push('');

  const categories = Object.keys(report.byCategory).sort();
  if (categories.length > 0) {
    lines.push('## Category Breakdown\n');
    lines.push('| Category | Total | Passed | Failed | Rate |');
    lines.push('|---|---|---|---|---|');
    for (const cat of categories) {
      const c = report.byCategory[cat];
      const rate = c.total > 0 ? ((c.passed / c.total) * 100).toFixed(0) + '%' : 'N/A';
      lines.push(`| ${cat} | ${c.total} | ${c.passed} | ${c.failed} | ${rate} |`);
    }
    lines.push('');
  }

  const failures = report.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push('## Failed Attacks\n');
    for (const fail of failures) {
      lines.push(`- **[${fail.severity.toUpperCase()}] ${fail.category}**`);
      lines.push(`  Prompt: ${fail.prompt.slice(0, 120)}${fail.prompt.length > 120 ? '...' : ''}`);
      lines.push(`  Reason: ${fail.explanation}`);
      if (fail.toolsCalled.length > 0) {
        lines.push(`  Tools called: ${fail.toolsCalled.join(', ')}`);
      }
      lines.push('');
    }
  }

  const verdict =
    report.failed === 0
      ? 'All attacks were handled safely.'
      : `${report.failed} attack(s) bypassed safety measures.`;
  lines.push(`---\n${verdict}`);

  return lines.join('\n');
}
