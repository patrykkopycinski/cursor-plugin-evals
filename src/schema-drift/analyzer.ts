import type { ProbeResult, DriftFinding, SchemaDriftReport } from './types.js';

export function analyzeDrift(results: ProbeResult[]): SchemaDriftReport {
  const findings: DriftFinding[] = [];
  const toolsSeen = new Set<string>();

  for (const r of results) {
    toolsSeen.add(r.input.tool);
    if (r.drift) {
      findings.push(r.drift);
      continue;
    }

    if (r.input.expectation === 'should_succeed' && r.isError) {
      const field = r.input.targetField ?? '(root)';
      findings.push({
        tool: r.input.tool,
        field,
        kind: 'hidden_required',
        declared: 'optional',
        actual: `required (server returned error: ${r.errorMessage ?? 'unknown'})`,
        severity: 'critical',
      });
    }

    if (r.input.expectation === 'should_fail' && r.success && !r.isError) {
      const field = r.input.targetField ?? '(root)';
      const kind = r.input.description.includes('Wrong type')
        ? 'accepts_invalid_type'
        : r.input.description.includes('enum')
          ? 'enum_mismatch'
          : r.input.description.includes('Extra unknown')
            ? 'additional_properties_rejected'
            : 'missing_error_on_invalid';
      findings.push({
        tool: r.input.tool,
        field,
        kind,
        declared: 'should reject',
        actual: 'accepted without error',
        severity: kind === 'accepts_invalid_type' ? 'warning' : 'info',
      });
    }
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;
  const driftScore =
    results.length > 0
      ? 1 - (criticalCount * 3 + warningCount * 1 + infoCount * 0.2) / (results.length * 3)
      : 1;

  return {
    toolsAnalyzed: toolsSeen.size,
    probesRun: results.length,
    findings,
    probeResults: results,
    criticalCount,
    warningCount,
    infoCount,
    driftScore: Math.max(0, Math.min(1, driftScore)),
  };
}

export function formatDriftReport(report: SchemaDriftReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('╔══════════════════════════════════════════════════╗');
  lines.push('║           SCHEMA DRIFT REPORT                    ║');
  lines.push('╚══════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Tools analyzed:    ${report.toolsAnalyzed}`);
  lines.push(`  Probes run:        ${report.probesRun}`);
  lines.push(`  Drift score:       ${(report.driftScore * 100).toFixed(1)}%`);
  lines.push(`  Critical:          ${report.criticalCount}`);
  lines.push(`  Warnings:          ${report.warningCount}`);
  lines.push(`  Info:              ${report.infoCount}`);
  lines.push('');

  if (report.findings.length > 0) {
    lines.push('  Findings:');
    for (const f of report.findings) {
      const icon = f.severity === 'critical' ? '✗' : f.severity === 'warning' ? '!' : '·';
      lines.push(`    ${icon} [${f.severity.toUpperCase()}] ${f.tool}.${f.field}: ${f.kind}`);
      lines.push(`      Declared: ${f.declared}`);
      lines.push(`      Actual:   ${f.actual}`);
    }
    lines.push('');
  }

  const grade =
    report.driftScore >= 0.95
      ? 'A'
      : report.driftScore >= 0.85
        ? 'B'
        : report.driftScore >= 0.7
          ? 'C'
          : report.driftScore >= 0.5
            ? 'D'
            : 'F';
  lines.push(`  Drift Grade:       ${grade} (${(report.driftScore * 100).toFixed(1)}%)`);
  lines.push('');
  return lines.join('\n');
}
