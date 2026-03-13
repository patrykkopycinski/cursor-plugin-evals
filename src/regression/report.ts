import chalk from 'chalk';
import type { RegressionResult, Verdict } from './detector.js';

function verdictColor(v: Verdict): (s: string) => string {
  switch (v) {
    case 'PASS':
      return chalk.green;
    case 'FAIL':
      return chalk.red;
    case 'INCONCLUSIVE':
      return chalk.yellow;
  }
}

function verdictIcon(v: Verdict): string {
  switch (v) {
    case 'PASS':
      return '✓';
    case 'FAIL':
      return '✗';
    case 'INCONCLUSIVE':
      return '?';
  }
}

export function formatRegressionReport(results: RegressionResult[]): string {
  if (results.length === 0) {
    return '  No regression data to compare.\n';
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold('━━━ Regression Report ━━━'));
  lines.push('');

  // Per-metric table
  const header = ['  Metric', 'Verdict', 'Baseline', 'Current', 'Delta', 'p-value'];
  const rows: string[][] = [header];

  for (const r of results) {
    const icon = verdictIcon(r.verdict);
    const color = verdictColor(r.verdict);
    rows.push([
      `  ${r.key}`,
      color(`${icon} ${r.verdict}`),
      r.baselineMean.toFixed(3),
      r.currentMean.toFixed(3),
      formatDelta(r.delta),
      r.pValue < 0.001 ? '<0.001' : r.pValue.toFixed(3),
    ]);
  }

  const widths = header.map((_, i) => Math.max(...rows.map((r) => stripAnsi(r[i]).length)));
  for (const row of rows) {
    lines.push(
      row
        .map((cell, i) => cell + ' '.repeat(Math.max(0, widths[i] - stripAnsi(cell).length)))
        .join('  '),
    );
  }

  lines.push('');

  // Per-suite summary
  const suites = new Map<string, RegressionResult[]>();
  for (const r of results) {
    const suite = r.key.split('.')[0];
    const arr = suites.get(suite);
    if (arr) arr.push(r);
    else suites.set(suite, [r]);
  }

  lines.push(chalk.bold('  Per-Suite Summary'));
  lines.push('');

  for (const [suite, suiteResults] of suites) {
    const worst = suiteResults.reduce((w, r) => (r.pValue < w.pValue ? r : w), suiteResults[0]);
    const failCount = suiteResults.filter((r) => r.verdict === 'FAIL').length;
    const passCount = suiteResults.filter((r) => r.verdict === 'PASS').length;
    const incCount = suiteResults.filter((r) => r.verdict === 'INCONCLUSIVE').length;

    const parts: string[] = [];
    if (passCount > 0) parts.push(chalk.green(`${passCount} pass`));
    if (failCount > 0) parts.push(chalk.red(`${failCount} fail`));
    if (incCount > 0) parts.push(chalk.yellow(`${incCount} inconclusive`));

    lines.push(
      `  ${suite.padEnd(30)} ${parts.join(', ')}  (worst p=${worst.pValue < 0.001 ? '<0.001' : worst.pValue.toFixed(3)})`,
    );
  }

  lines.push('');

  // Overall verdict
  const totalFail = results.filter((r) => r.verdict === 'FAIL').length;
  const totalPass = results.filter((r) => r.verdict === 'PASS').length;
  const totalInc = results.filter((r) => r.verdict === 'INCONCLUSIVE').length;

  if (totalFail > 0) {
    lines.push(
      chalk.red(
        `  ✗ REGRESSION DETECTED — ${totalFail} metric(s) degraded, ${totalPass} stable, ${totalInc} inconclusive`,
      ),
    );
  } else if (totalInc > 0) {
    lines.push(
      chalk.yellow(`  ? ${totalPass} stable, ${totalInc} inconclusive (need more samples)`),
    );
  } else {
    lines.push(chalk.green(`  ✓ No regressions — all ${totalPass} metric(s) stable`));
  }

  lines.push('');

  return lines.join('\n');
}

function formatDelta(d: number): string {
  const sign = d >= 0 ? '+' : '';
  const formatted = `${sign}${d.toFixed(3)}`;
  if (d < 0) return chalk.red(formatted);
  if (d > 0) return chalk.green(formatted);
  return formatted;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
