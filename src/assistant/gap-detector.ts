import type { CodebaseProfile, CoverageAuditReport, DetectedGap } from './types.js';

export function detectGaps(
  profile: CodebaseProfile,
  audit: CoverageAuditReport,
): DetectedGap[] {
  const gaps: DetectedGap[] = [];

  for (const gap of audit.gaps) {
    gaps.push({
      id: `user-${gap.id}`,
      target: 'user',
      severity: gap.severity,
      category: gap.category,
      title: gap.title,
      description: gap.description,
      suggestedFix: gap.recommendation,
      autoFixable: gap.autoFixable,
    });
  }

  for (const issue of profile.configIssues) {
    if (issue.severity === 'error') {
      gaps.push({
        id: `user-config-${issue.category}`,
        target: 'user',
        severity: 'high',
        category: 'config',
        title: issue.message,
        description: issue.message,
        suggestedFix: issue.fix ?? 'Fix the configuration issue',
        autoFixable: !!issue.fix,
      });
    }
  }

  const totalTests = profile.evalFiles.reduce((s, e) => s + e.testCount, 0);

  if (totalTests > 20 && !profile.evaluatorsUsed.includes('trajectory')) {
    gaps.push({
      id: 'framework-trajectory-eval',
      target: 'framework',
      severity: 'low',
      category: 'evaluator-gap',
      title: 'Trajectory evaluator underutilized',
      description: 'Large test suites would benefit from trajectory analysis but the framework docs do not highlight it',
      suggestedFix: 'Add trajectory evaluator to the recommended evaluators in the getting-started guide',
      autoFixable: true,
      filesToModify: ['README.md'],
    });
  }

  if (profile.projectKind === 'skill-repository' && profile.evalFiles.length === 0) {
    gaps.push({
      id: 'user-no-skill-evals',
      target: 'user',
      severity: 'critical',
      category: 'coverage',
      title: 'Skill repository has no evaluation files',
      description: 'This skill repository has zero eval.yaml files — no quality measurement exists',
      suggestedFix: 'Generate eval.yaml files for each skill using the eval-generator',
      autoFixable: true,
      filesToCreate: profile.skills.map((s) => `${s.path}/../eval.yaml`),
    });
  }

  if (profile.layerCoverage['performance'] === 0 && totalTests > 10) {
    gaps.push({
      id: 'user-no-perf-tests',
      target: 'user',
      severity: 'medium',
      category: 'layer-coverage',
      title: 'No performance tests despite large test suite',
      description: `${totalTests} tests exist but none measure latency or throughput`,
      suggestedFix: 'Add performance layer tests for critical tools',
      autoFixable: true,
    });
  }

  return gaps.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return (order[a.severity] ?? 5) - (order[b.severity] ?? 5);
  });
}

export function formatGapReport(gaps: DetectedGap[]): string {
  const lines: string[] = [];
  lines.push('# Gap Analysis Report');
  lines.push('');

  const userGaps = gaps.filter((g) => g.target === 'user');
  const frameworkGaps = gaps.filter((g) => g.target === 'framework');

  if (userGaps.length > 0) {
    lines.push(`## User Repository Gaps (${userGaps.length})`);
    for (const g of userGaps) {
      const fixable = g.autoFixable ? ' [auto-fixable]' : '';
      lines.push(`\n### [${g.severity.toUpperCase()}] ${g.title}${fixable}`);
      lines.push(g.description);
      lines.push(`**Fix:** ${g.suggestedFix}`);
    }
    lines.push('');
  }

  if (frameworkGaps.length > 0) {
    lines.push(`## Framework Gaps (${frameworkGaps.length})`);
    for (const g of frameworkGaps) {
      lines.push(`\n### [${g.severity.toUpperCase()}] ${g.title}`);
      lines.push(g.description);
      lines.push(`**Suggested fix:** ${g.suggestedFix}`);
      if (g.filesToModify?.length) lines.push(`**Files:** ${g.filesToModify.join(', ')}`);
    }
  }

  if (gaps.length === 0) {
    lines.push('No gaps detected — coverage looks comprehensive.');
  }

  return lines.join('\n');
}
