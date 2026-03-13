import type { ChaosReport } from './types.js';

export function formatChaosReport(report: ChaosReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('╔══════════════════════════════════════════════════╗');
  lines.push('║           CHAOS ENGINEERING REPORT               ║');
  lines.push('╚══════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Total requests:    ${report.totalRequests}`);
  lines.push(`  Faults injected:   ${report.faultsInjected}`);
  lines.push(`  Survived:          ${report.survivedCount}`);
  lines.push(`  Crashed:           ${report.crashedCount}`);
  lines.push(`  Survival rate:     ${(report.survivalRate * 100).toFixed(1)}%`);
  lines.push('');

  if (Object.keys(report.faultsByKind).length > 0) {
    lines.push('  Faults by kind:');
    for (const [kind, count] of Object.entries(report.faultsByKind)) {
      const bar = '█'.repeat(Math.min(count, 40));
      lines.push(`    ${kind.padEnd(16)} ${String(count).padStart(4)} ${bar}`);
    }
    lines.push('');
  }

  if (report.events.length > 0) {
    lines.push('  Event log (last 20):');
    const shown = report.events.slice(-20);
    for (const e of shown) {
      lines.push(
        `    [${new Date(e.timestamp).toISOString().slice(11, 23)}] ${e.fault.padEnd(16)} ${e.tool} — ${e.details}`,
      );
    }
    lines.push('');
  }

  const grade =
    report.survivalRate >= 0.95
      ? 'A'
      : report.survivalRate >= 0.85
        ? 'B'
        : report.survivalRate >= 0.7
          ? 'C'
          : report.survivalRate >= 0.5
            ? 'D'
            : 'F';

  lines.push(`  Resilience Grade:  ${grade} (${(report.survivalRate * 100).toFixed(1)}%)`);
  lines.push('');
  return lines.join('\n');
}
