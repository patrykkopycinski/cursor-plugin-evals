import { SAFE_MCP_TECHNIQUES } from './techniques.js';

export interface ComplianceMapping {
  techniqueId: string;
  techniqueName: string;
  tactic: string;
  coveredBy: string[];
  coverage: 'full' | 'partial' | 'none';
}

export interface ComplianceReport {
  totalTechniques: number;
  coveredFull: number;
  coveredPartial: number;
  uncovered: number;
  coveragePercent: number;
  tacticCoverage: Record<string, { total: number; covered: number; percent: number }>;
  mappings: ComplianceMapping[];
}

const RULE_TO_TECHNIQUE: Record<string, string[]> = {
  'tool-poisoning': ['SAFE-T1001', 'SAFE-T1002'],
  'prompt-injection': ['SAFE-T1101', 'SAFE-T1102'],
  'command-injection': ['SAFE-T1701'],
  'privilege-escalation': ['SAFE-T1501', 'SAFE-T1502'],
  'token-mismanagement': ['SAFE-T1301', 'SAFE-T1303'],
  'sensitive-data-exposure': ['SAFE-T1302'],
  'data-exfiltration': ['SAFE-T1401', 'SAFE-T1402'],
  'supply-chain': ['SAFE-T1801'],
  'shadow-server': ['SAFE-T1802'],
  'insecure-deserialization': ['SAFE-T1803'],
  'unsafe-redirect': ['SAFE-T1901'],
  'missing-audit': ['SAFE-T1902'],
  'context-oversharing': ['SAFE-T1601'],
  'resource-exhaustion': ['SAFE-T1202'],
  'denial-of-service': ['SAFE-T1203'],
  'insufficient-auth': ['SAFE-T1103'],
  'cross-tool-contamination': ['SAFE-T1402'],
  'ssrf': ['SAFE-T1702'],
  'path-traversal': ['SAFE-T1703'],
};

const RED_TEAM_TO_TECHNIQUE: Record<string, string[]> = {
  'tool-poisoning': ['SAFE-T1001', 'SAFE-T1002'],
  'prompt-injection': ['SAFE-T1101', 'SAFE-T1102'],
  'credential-theft': ['SAFE-T1301', 'SAFE-T1302'],
  'data-exfiltration': ['SAFE-T1401'],
  'privilege-escalation': ['SAFE-T1501'],
  'resource-abuse': ['SAFE-T1202', 'SAFE-T1203'],
  'system-prompt-leak': ['SAFE-T1602'],
  'ssrf': ['SAFE-T1702'],
  'path-traversal': ['SAFE-T1703'],
  'supply-chain': ['SAFE-T1801'],
};

export function buildComplianceReport(
  activeRules: string[],
  activeRedTeamCategories: string[],
): ComplianceReport {
  const techniqueCovers = new Map<string, Set<string>>();

  for (const t of SAFE_MCP_TECHNIQUES) {
    techniqueCovers.set(t.id, new Set());
  }

  for (const rule of activeRules) {
    const ids = RULE_TO_TECHNIQUE[rule] ?? [];
    for (const id of ids) {
      techniqueCovers.get(id)?.add(`rule:${rule}`);
    }
  }

  for (const cat of activeRedTeamCategories) {
    const ids = RED_TEAM_TO_TECHNIQUE[cat] ?? [];
    for (const id of ids) {
      techniqueCovers.get(id)?.add(`red-team:${cat}`);
    }
  }

  const mappings: ComplianceMapping[] = SAFE_MCP_TECHNIQUES.map((t) => {
    const covers = techniqueCovers.get(t.id) ?? new Set<string>();
    return {
      techniqueId: t.id,
      techniqueName: t.name,
      tactic: t.tactic,
      coveredBy: [...covers],
      coverage: covers.size >= 2 ? 'full' : covers.size === 1 ? 'partial' : 'none',
    };
  });

  const coveredFull = mappings.filter((m) => m.coverage === 'full').length;
  const coveredPartial = mappings.filter((m) => m.coverage === 'partial').length;
  const uncovered = mappings.filter((m) => m.coverage === 'none').length;
  const total = mappings.length;

  const tacticMap = new Map<string, { total: number; covered: number }>();
  for (const m of mappings) {
    const entry = tacticMap.get(m.tactic) ?? { total: 0, covered: 0 };
    entry.total++;
    if (m.coverage !== 'none') entry.covered++;
    tacticMap.set(m.tactic, entry);
  }

  const tacticCoverage: Record<string, { total: number; covered: number; percent: number }> = {};
  for (const [tactic, { total: t, covered: c }] of tacticMap) {
    tacticCoverage[tactic] = { total: t, covered: c, percent: t > 0 ? (c / t) * 100 : 0 };
  }

  return {
    totalTechniques: total,
    coveredFull,
    coveredPartial,
    uncovered,
    coveragePercent: total > 0 ? ((coveredFull + coveredPartial) / total) * 100 : 0,
    tacticCoverage,
    mappings,
  };
}

export function formatComplianceReport(report: ComplianceReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('╔══════════════════════════════════════════════════╗');
  lines.push('║       SAFE-MCP COMPLIANCE REPORT                 ║');
  lines.push('╚══════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`  Total techniques:  ${report.totalTechniques}`);
  lines.push(`  Full coverage:     ${report.coveredFull}`);
  lines.push(`  Partial coverage:  ${report.coveredPartial}`);
  lines.push(`  Uncovered:         ${report.uncovered}`);
  lines.push(`  Overall:           ${report.coveragePercent.toFixed(1)}%`);
  lines.push('');
  lines.push('  Coverage by Tactic:');
  for (const [tactic, stats] of Object.entries(report.tacticCoverage)) {
    const bar = '█'.repeat(Math.round(stats.percent / 5));
    const pad = '░'.repeat(20 - Math.round(stats.percent / 5));
    lines.push(
      `    ${tactic.replace(/_/g, ' ').padEnd(22)} ${bar}${pad} ${stats.covered}/${stats.total} (${stats.percent.toFixed(0)}%)`,
    );
  }
  lines.push('');
  lines.push('  Technique Details:');
  for (const m of report.mappings) {
    const icon = m.coverage === 'full' ? '●' : m.coverage === 'partial' ? '◐' : '○';
    lines.push(`    ${icon} ${m.techniqueId} ${m.techniqueName}`);
    if (m.coveredBy.length > 0) {
      lines.push(`      Covered by: ${m.coveredBy.join(', ')}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
