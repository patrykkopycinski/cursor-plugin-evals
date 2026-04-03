import type { CodebaseProfile, CoverageAuditReport, CoverageGap } from './types.js';
import { CLI_NAME } from '../core/constants.js';

const RECOMMENDED_LAYERS = ['unit', 'integration', 'llm', 'static'] as const;
const SECURITY_EVALUATORS = ['security', 'tool-poisoning'];
const TOOL_EVALUATORS = ['tool-selection', 'tool-args', 'tool-sequence'];

export function auditCoverage(profile: CodebaseProfile): CoverageAuditReport {
  const gaps: CoverageGap[] = [];

  const totalTools = profile.mcpTools.length || profile.toolCoverage.size || 0;
  const coveredTools = profile.toolCoverage.size;

  if (totalTools > 0 && coveredTools < totalTools) {
    const uncovered = totalTools - coveredTools;
    const uncoveredNames = profile.mcpTools
      .map((t) => t.name)
      .filter((name) => !profile.toolCoverage.has(name));
    gaps.push({
      id: 'tool-coverage',
      severity: uncovered > totalTools / 2 ? 'critical' : 'high',
      category: 'tool-coverage',
      title: `${uncovered} tool(s) have no tests`,
      description: `${coveredTools} of ${totalTools} tools are covered by evaluations`,
      recommendation: 'Run eval-generator to auto-generate tests for uncovered tools',
      autoFixable: true,
      affectedTools: uncoveredNames.length > 0 ? uncoveredNames : undefined,
    });
  }

  for (const layer of RECOMMENDED_LAYERS) {
    if (profile.layerCoverage[layer] === 0) {
      gaps.push({
        id: `missing-layer-${layer}`,
        severity: layer === 'integration' || layer === 'llm' ? 'high' : 'medium',
        category: 'layer-coverage',
        title: `No ${layer} layer tests`,
        description: `The ${layer} layer has zero tests — this dimension is not evaluated`,
        recommendation: `Add ${layer} layer tests to your eval config`,
        autoFixable: true,
      });
    }
  }

  const usesSecurityEval = SECURITY_EVALUATORS.some((e) => profile.evaluatorsUsed.includes(e));
  if (!usesSecurityEval) {
    gaps.push({
      id: 'no-security-eval',
      severity: 'high',
      category: 'security',
      title: 'No security evaluators configured',
      description: 'Security and tool-poisoning evaluators are not being used',
      recommendation: 'Add "security" and "tool-poisoning" to your evaluator list',
      autoFixable: true,
    });
  }

  const usesToolEval = TOOL_EVALUATORS.some((e) => profile.evaluatorsUsed.includes(e));
  if (!usesToolEval && profile.layerCoverage['llm'] > 0) {
    gaps.push({
      id: 'no-tool-evaluators',
      severity: 'medium',
      category: 'evaluator-coverage',
      title: 'LLM tests missing tool evaluators',
      description: 'LLM layer tests exist but tool-selection/tool-args are not evaluated',
      recommendation: 'Add "tool-selection" and "tool-args" to LLM test evaluators',
      autoFixable: true,
    });
  }

  const evalUtilization = profile.evaluatorsUsed.length / profile.evaluatorsAvailable.length;
  if (evalUtilization < 0.3) {
    gaps.push({
      id: 'low-evaluator-utilization',
      severity: 'medium',
      category: 'evaluator-coverage',
      title: `Only ${Math.round(evalUtilization * 100)}% of evaluators used`,
      description: `Using ${profile.evaluatorsUsed.length} of ${profile.evaluatorsAvailable.length} available evaluators`,
      recommendation: 'Consider adding correctness, groundedness, content-quality evaluators',
      autoFixable: false,
    });
  }

  if (!profile.hasFixtures) {
    gaps.push({
      id: 'no-fixtures',
      severity: 'medium',
      category: 'infrastructure',
      title: 'No recorded fixtures for mock mode',
      description: 'Without fixtures, CI runs require a live MCP server',
      recommendation: `Run \`npx ${CLI_NAME} run --record\` to capture fixtures`,
      autoFixable: false,
    });
  }

  if (!profile.hasFingerprints) {
    gaps.push({
      id: 'no-regression-baseline',
      severity: 'low',
      category: 'infrastructure',
      title: 'No regression detection baseline',
      description: 'Without a fingerprint, score regressions cannot be detected',
      recommendation: 'Run an eval and save the fingerprint as a baseline',
      autoFixable: false,
    });
  }

  if (!profile.hasCI) {
    gaps.push({
      id: 'no-ci',
      severity: 'medium',
      category: 'infrastructure',
      title: 'No CI configuration',
      description: 'Evaluations are not enforced in CI/CD pipelines',
      recommendation: `Run \`npx ${CLI_NAME} ci-init\` to scaffold CI config`,
      autoFixable: true,
    });
  }

  if (profile.hasCI && !profile.hasCiThresholds) {
    gaps.push({
      id: 'no-ci-thresholds',
      severity: 'medium',
      category: 'infrastructure',
      title: 'CI configured but no quality thresholds',
      description: 'CI runs evals but does not gate on quality — failures will not block merges',
      recommendation: 'Add score/latency/evaluator thresholds to the ci section',
      autoFixable: true,
    });
  }

  const difficulties = new Set<string>();
  for (const [, tc] of profile.toolCoverage) {
    for (const d of tc.difficulties) difficulties.add(d);
  }
  if (difficulties.size <= 1 && profile.evalFiles.length > 0) {
    gaps.push({
      id: 'single-difficulty',
      severity: 'low',
      category: 'test-quality',
      title: 'All tests at same difficulty level',
      description: 'Tests lack difficulty diversity — complex and adversarial cases missing',
      recommendation: 'Add complex and adversarial test cases to stress-test the plugin',
      autoFixable: true,
    });
  }

  const overallScore = Math.max(0, 100 - gaps.reduce((sum, g) => {
    const weight = { critical: 20, high: 15, medium: 10, low: 5, info: 2 };
    return sum + (weight[g.severity] ?? 5);
  }, 0));

  const layerCov: Record<string, number> = {};
  for (const [layer, count] of Object.entries(profile.layerCoverage)) {
    layerCov[layer] = count > 0 ? 1 : 0;
  }

  return {
    timestamp: new Date().toISOString(),
    overallScore,
    gaps,
    summary: {
      totalTools: totalTools,
      coveredTools,
      layerCoverage: layerCov,
      evaluatorCoverage: evalUtilization,
      difficultyDistribution: Object.fromEntries([...difficulties].map((d) => [d, 1])),
      securityCoverage: usesSecurityEval,
      performanceCoverage: profile.layerCoverage['performance'] > 0,
      regressionBaseline: profile.hasFingerprints,
    },
  };
}

export function formatAuditReport(report: CoverageAuditReport): string {
  const lines: string[] = [];
  lines.push('# Coverage Audit Report');
  lines.push('');
  lines.push(`**Overall Score:** ${report.overallScore}/100`);
  lines.push(`**Gaps Found:** ${report.gaps.length}`);
  lines.push('');

  lines.push('## Summary');
  lines.push(`- Tools covered: ${report.summary.coveredTools}/${report.summary.totalTools}`);
  lines.push(`- Evaluator utilization: ${Math.round(report.summary.evaluatorCoverage * 100)}%`);
  lines.push(`- Security coverage: ${report.summary.securityCoverage ? 'Yes' : 'No'}`);
  lines.push(`- Performance coverage: ${report.summary.performanceCoverage ? 'Yes' : 'No'}`);
  lines.push(`- Regression baseline: ${report.summary.regressionBaseline ? 'Yes' : 'No'}`);
  lines.push('');

  if (report.gaps.length > 0) {
    lines.push('## Gaps (by priority)');
    const sorted = [...report.gaps].sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (order[a.severity] ?? 5) - (order[b.severity] ?? 5);
    });
    for (const gap of sorted) {
      const icon = gap.autoFixable ? ' [auto-fixable]' : '';
      lines.push(`\n### [${gap.severity.toUpperCase()}] ${gap.title}${icon}`);
      lines.push(gap.description);
      if (gap.affectedTools && gap.affectedTools.length > 0) {
        const display = gap.affectedTools.length <= 15
          ? gap.affectedTools.join(', ')
          : `${gap.affectedTools.slice(0, 15).join(', ')} (+${gap.affectedTools.length - 15} more)`;
        lines.push(`**Uncovered tools:** ${display}`);
      }
      lines.push(`**Recommendation:** ${gap.recommendation}`);
    }
  }

  return lines.join('\n');
}
