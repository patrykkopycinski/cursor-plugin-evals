import type { FuzzResult, FuzzReport } from './types.js';

export function analyzeFuzzResults(toolName: string, results: FuzzResult[]): FuzzReport {
  const categories: Record<string, { total: number; crashed: number }> = {};
  for (const r of results) {
    const cat = r.input.category;
    if (!categories[cat]) categories[cat] = { total: 0, crashed: 0 };
    categories[cat].total++;
    if (r.crashed) categories[cat].crashed++;
  }

  return {
    toolName,
    totalInputs: results.length,
    accepted: results.filter(r => r.accepted).length,
    rejected: results.filter(r => !r.accepted && !r.crashed).length,
    crashed: results.filter(r => r.crashed).length,
    results,
    crashRate: results.length > 0 ? results.filter(r => r.crashed).length / results.length : 0,
    categories,
  };
}

export function formatFuzzReport(report: FuzzReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('╔══════════════════════════════════════════════════╗');
  lines.push('║           FUZZ TESTING REPORT                    ║');
  lines.push('╚══════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Tool:              ${report.toolName}`);
  lines.push(`  Total inputs:      ${report.totalInputs}`);
  lines.push(`  Accepted:          ${report.accepted}`);
  lines.push(`  Rejected:          ${report.rejected}`);
  lines.push(`  Crashed:           ${report.crashed}`);
  lines.push(`  Crash rate:        ${(report.crashRate * 100).toFixed(1)}%`);
  lines.push('');

  if (Object.keys(report.categories).length > 0) {
    lines.push('  By category:');
    for (const [cat, stats] of Object.entries(report.categories)) {
      const crashPct = stats.total > 0 ? ((stats.crashed / stats.total) * 100).toFixed(0) : '0';
      lines.push(`    ${cat.padEnd(18)} ${String(stats.total).padStart(4)} inputs, ${String(stats.crashed).padStart(3)} crashes (${crashPct}%)`);
    }
    lines.push('');
  }

  const crashes = report.results.filter(r => r.crashed);
  if (crashes.length > 0) {
    lines.push('  Crash details (first 10):');
    for (const c of crashes.slice(0, 10)) {
      lines.push(`    ✗ ${c.input.description}`);
      if (c.errorMessage) lines.push(`      Error: ${c.errorMessage.slice(0, 120)}`);
    }
    lines.push('');
  }

  const grade = report.crashRate === 0 ? 'A' :
    report.crashRate <= 0.05 ? 'B' :
    report.crashRate <= 0.15 ? 'C' :
    report.crashRate <= 0.30 ? 'D' : 'F';
  lines.push(`  Robustness Grade:  ${grade} (${((1 - report.crashRate) * 100).toFixed(1)}% survive)`);
  lines.push('');
  return lines.join('\n');
}
