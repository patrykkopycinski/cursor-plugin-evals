import type { CoverageReport, ComponentCoverage } from './analyzer.js';

const LAYER_NAMES = ['unit', 'integration', 'llm', 'performance', 'security', 'static'] as const;
const LAYER_HEADERS = ['unit', 'integ', 'llm', 'perf', 'sec', 'static'] as const;

function layerPercent(comp: ComponentCoverage): number {
  let covered = 0;
  let total = LAYER_NAMES.length;
  for (const layer of LAYER_NAMES) {
    if (comp.layers[layer]) covered++;
  }
  return Math.round((covered / total) * 100);
}

export function formatCoverageTerminal(report: CoverageReport): string {
  const lines: string[] = [];

  lines.push(`Coverage Matrix — ${report.pluginName}`);
  lines.push('');
  lines.push(`Component Coverage: ${report.coveragePercent}% (${report.coveredComponents}/${report.totalComponents} have tests)`);
  lines.push(`Depth Coverage:     ${report.depthPercent}% (${report.slotsFilled}/${report.slotsTotal} applicable test slots filled)`);
  lines.push('');

  const maxName = Math.max(24, ...report.components.map((c) => c.name.length));
  const pad = (s: string, n: number) => s.padEnd(n);

  const header =
    pad('', maxName) +
    '  ' +
    LAYER_HEADERS.map((h) => h.padStart(6)).join('  ') +
    '        ';
  lines.push(header);

  const byType = new Map<string, ComponentCoverage[]>();
  for (const comp of report.components) {
    const list = byType.get(comp.type) ?? [];
    list.push(comp);
    byType.set(comp.type, list);
  }

  for (const [type, components] of byType) {
    if (report.components.length > 10 && byType.size > 1) {
      lines.push('');
      lines.push(`  ${type.toUpperCase()}S`);
    }
    for (const comp of components) {
      const symbols = LAYER_NAMES.map((layer) => {
        if (comp.type !== 'tool' && (layer === 'unit' || layer === 'integration' || layer === 'performance')) {
          return '\u2717';
        }
        return comp.layers[layer] ? '\u2713' : '\u00B7';
      });
      const pct = layerPercent(comp);
      const pctStr = `(${String(pct).padStart(3)}%)`;
      lines.push(
        pad(comp.name, maxName) +
          '  ' +
          symbols.map((s) => s.padStart(6)).join('  ') +
          '    ' +
          pctStr,
      );
    }
  }

  lines.push('');
  lines.push(`Legend: \u2713 = covered, \u00B7 = missing, \u2717 = not applicable`);
  lines.push('');

  const { tools, skills, rules, agents, commands } = report.byType;
  const summaryParts: string[] = [];
  if (tools.total > 0) summaryParts.push(`${tools.covered}/${tools.total} tools`);
  if (skills.total > 0) summaryParts.push(`${skills.covered}/${skills.total} skills`);
  if (rules.total > 0) summaryParts.push(`${rules.covered}/${rules.total} rules`);
  if (agents.total > 0) summaryParts.push(`${agents.covered}/${agents.total} agents`);
  if (commands.total > 0) summaryParts.push(`${commands.covered}/${commands.total} commands`);
  lines.push(`Summary: ${summaryParts.join(' | ')}`);

  if (report.gaps.length > 0) {
    lines.push('');
    const critCount = report.gaps.filter((g) => g.severity === 'critical').length;
    const highCount = report.gaps.filter((g) => g.severity === 'high').length;
    const medCount = report.gaps.filter((g) => g.severity === 'medium').length;
    const lowCount = report.gaps.filter((g) => g.severity === 'low').length;
    lines.push(
      `Gaps: ${critCount} critical, ${highCount} high, ${medCount} medium, ${lowCount} low`,
    );
  }

  return lines.join('\n');
}

export function formatCoverageMarkdown(report: CoverageReport): string {
  const lines: string[] = [];

  lines.push(`# Coverage Report — ${report.pluginName}`);
  lines.push('');
  lines.push(`**Component Coverage:** ${report.coveragePercent}% (${report.coveredComponents}/${report.totalComponents} components have at least one test)`);
  lines.push(`**Depth Coverage:** ${report.depthPercent}% (${report.slotsFilled}/${report.slotsTotal} applicable test slots filled)`);
  lines.push('');

  lines.push('## Coverage by Type');
  lines.push('');
  lines.push('| Type | Covered | Total | Percent |');
  lines.push('|------|---------|-------|---------|');
  const types = ['tools', 'skills', 'rules', 'agents', 'commands'] as const;
  for (const t of types) {
    const d = report.byType[t];
    if (d.total > 0) {
      lines.push(`| ${t} | ${d.covered} | ${d.total} | ${d.percent}% |`);
    }
  }
  lines.push('');

  lines.push('## Coverage Matrix');
  lines.push('');
  lines.push(
    '| Component | Type | unit | integ | llm | perf | sec | static |',
  );
  lines.push(
    '|-----------|------|------|-------|-----|------|-----|--------|',
  );

  for (const comp of report.components) {
    const cells = LAYER_NAMES.map((layer) => {
      if (comp.type !== 'tool' && (layer === 'unit' || layer === 'integration' || layer === 'performance')) {
        return 'n/a';
      }
      return comp.layers[layer] ? '\u2705' : '\u274C';
    });
    lines.push(`| ${comp.name} | ${comp.type} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  lines.push('## Layer Coverage');
  lines.push('');
  lines.push('| Layer | Tested | Total | Percent |');
  lines.push('|-------|--------|-------|---------|');
  for (const [layer, data] of Object.entries(report.layerCoverage)) {
    lines.push(`| ${layer} | ${data.tested} | ${data.total} | ${data.percent}% |`);
  }
  lines.push('');

  if (report.gaps.length > 0) {
    lines.push('## Gaps');
    lines.push('');
    for (const gap of report.gaps) {
      const icon =
        gap.severity === 'critical'
          ? '\u{1F534}'
          : gap.severity === 'high'
            ? '\u{1F7E0}'
            : gap.severity === 'medium'
              ? '\u{1F7E1}'
              : '\u{1F535}';
      lines.push(`- ${icon} **${gap.severity}**: ${gap.message}`);
    }
    lines.push('');
  }

  lines.push(`_Generated at ${report.timestamp}_`);

  return lines.join('\n');
}

export function formatCoverageJson(report: CoverageReport): string {
  return JSON.stringify(report, null, 2);
}

export function generateCoverageBadge(report: CoverageReport): string {
  const pct = report.depthPercent;
  const color = pct >= 90 ? '#4c1' : pct >= 75 ? '#97CA00' : pct >= 50 ? '#dfb317' : pct >= 25 ? '#fe7d37' : '#e05d44';

  const label = 'coverage';
  const value = `${pct}%`;

  const labelWidth = 64;
  const valueWidth = 44;
  const totalWidth = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="a">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#a)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#b)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;
}
