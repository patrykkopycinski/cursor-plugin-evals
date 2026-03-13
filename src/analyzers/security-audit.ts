import type { ToolDefinition, CapabilityGraph } from './capability-graph.js';
import { inferCapabilities, buildCapabilityGraph } from './capability-graph.js';
import type { DependencyAuditResult } from './dependency-audit.js';
import { auditPluginDependencies } from './dependency-audit.js';

export interface SecurityAuditResult {
  pass1_static: { findings: number; critical: number; high: number };
  pass2_capability: CapabilityGraph;
  pass3_dependency: DependencyAuditResult;
  overallScore: number;
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
}

interface SecurityAuditOptions {
  skipDependencyAudit?: boolean;
}

function scoreFromCapability(graph: CapabilityGraph): number {
  return Math.max(0, 100 - graph.riskScore);
}

function scoreFromDependency(result: DependencyAuditResult): number {
  const penaltyMap: Record<string, number> = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 3,
  };
  const raw = result.riskIndicators.reduce((sum, i) => sum + (penaltyMap[i.severity] ?? 0), 0);
  return Math.max(0, 100 - raw);
}

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export async function runSecurityAudit(
  tools: ToolDefinition[],
  pluginDir: string,
  options?: SecurityAuditOptions,
): Promise<SecurityAuditResult> {
  const capabilities = inferCapabilities(tools);
  const graph = buildCapabilityGraph(capabilities);

  const depResult: DependencyAuditResult = options?.skipDependencyAudit
    ? { totalDependencies: 0, directDependencies: 0, riskIndicators: [], overallRisk: 'low' }
    : await auditPluginDependencies(pluginDir);

  const capScore = scoreFromCapability(graph);
  const depScore = scoreFromDependency(depResult);

  const criticalFindings = graph.findings.filter((f) => f.severity === 'critical').length;
  const highFindings = graph.findings.filter((f) => f.severity === 'high').length;

  const overallScore = Math.round(capScore * 0.6 + depScore * 0.4);
  const overallGrade = gradeFromScore(overallScore);

  const totalFindings =
    graph.findings.length + depResult.riskIndicators.length;

  const summary = [
    `Security Audit: Grade ${overallGrade} (${overallScore}/100)`,
    `  Pass 2 — Capability Graph: ${graph.findings.length} findings, risk score ${graph.riskScore}/100`,
    `  Pass 3 — Dependencies: ${depResult.riskIndicators.length} indicators, risk ${depResult.overallRisk}`,
    totalFindings === 0
      ? '  No security issues detected.'
      : `  ${totalFindings} total issues found.`,
  ].join('\n');

  return {
    pass1_static: {
      findings: 0,
      critical: 0,
      high: 0,
    },
    pass2_capability: graph,
    pass3_dependency: depResult,
    overallScore,
    overallGrade,
    summary,
  };
}

export function formatSecurityAuditReport(result: SecurityAuditResult): string {
  const lines: string[] = ['# Security Audit Report\n'];

  lines.push(`**Grade:** ${result.overallGrade} (${result.overallScore}/100)\n`);

  lines.push('## Pass 1: Static Analysis\n');
  if (result.pass1_static.findings === 0) {
    lines.push('No static analysis findings (run separately via security-lint).\n');
  } else {
    lines.push(
      `${result.pass1_static.findings} findings (${result.pass1_static.critical} critical, ${result.pass1_static.high} high)\n`,
    );
  }

  lines.push('## Pass 2: Capability Graph\n');
  const cap = result.pass2_capability;
  lines.push(`- **Tools analyzed:** ${cap.tools.length}`);
  lines.push(`- **Risk score:** ${cap.riskScore}/100`);
  lines.push(`- **Findings:** ${cap.findings.length}`);
  lines.push(`- **Edges:** ${cap.edges.length}\n`);

  if (cap.findings.length > 0) {
    for (const f of cap.findings) {
      lines.push(`  - **[${f.severity.toUpperCase()}]** ${f.title}: ${f.description}`);
    }
    lines.push('');
  }

  lines.push('## Pass 3: Dependency Audit\n');
  const dep = result.pass3_dependency;
  lines.push(`- **Direct dependencies:** ${dep.directDependencies}`);
  lines.push(`- **Total dependencies:** ${dep.totalDependencies}`);
  lines.push(`- **Overall risk:** ${dep.overallRisk}`);
  lines.push(`- **Indicators:** ${dep.riskIndicators.length}\n`);

  if (dep.riskIndicators.length > 0) {
    for (const i of dep.riskIndicators) {
      lines.push(`  - **[${i.severity.toUpperCase()}]** ${i.indicator}: ${i.description}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(result.summary);
  lines.push('');

  return lines.join('\n');
}
