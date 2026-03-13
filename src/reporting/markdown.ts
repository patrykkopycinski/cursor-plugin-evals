import type { RunResult, SuiteResult, TestResult, Difficulty } from '../core/types.js';
import { formatDuration } from '../core/utils.js';

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

function passIcon(pass: boolean): string {
  return pass ? '✅' : '❌';
}

function suiteTable(suites: SuiteResult[]): string {
  const lines: string[] = [];
  lines.push('| Suite | Layer | Tests | Pass Rate | Duration |');
  lines.push('|-------|-------|------:|----------:|---------:|');
  for (const s of suites) {
    const rate = (s.passRate * 100).toFixed(1);
    lines.push(
      `| ${escapeCell(s.name)} | ${s.layer} | ${s.tests.length} | ${rate}% | ${formatDuration(s.duration)} |`,
    );
  }
  return lines.join('\n');
}

function testTable(tests: TestResult[]): string {
  const lines: string[] = [];
  lines.push('| Test | Difficulty | Status | Latency | Model |');
  lines.push('|------|-----------|:------:|--------:|-------|');
  for (const t of tests) {
    const difficulty = (t as { difficulty?: Difficulty }).difficulty ?? '—';
    lines.push(
      `| ${escapeCell(t.name)} | ${difficulty} | ${passIcon(t.pass)} | ${formatDuration(t.latencyMs)} | ${t.model ?? '—'} |`,
    );
  }
  return lines.join('\n');
}

function evaluatorScoreTable(suite: SuiteResult): string {
  const names = Object.keys(suite.evaluatorSummary);
  if (names.length === 0) return '';

  const lines: string[] = [];
  lines.push('| Evaluator | Mean | Min | Max | Pass Rate |');
  lines.push('|-----------|-----:|----:|----:|----------:|');
  for (const name of names) {
    const s = suite.evaluatorSummary[name];
    const rate = s.total > 0 ? ((s.pass / s.total) * 100).toFixed(1) : '0.0';
    lines.push(
      `| ${escapeCell(name)} | ${s.mean.toFixed(2)} | ${s.min.toFixed(2)} | ${s.max.toFixed(2)} | ${rate}% (${s.pass}/${s.total}) |`,
    );
  }
  return lines.join('\n');
}

function failureDetails(result: RunResult): string {
  const failures = result.suites.flatMap((s) => s.tests.filter((t) => !t.pass));
  if (failures.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Failure Details\n');
  for (const test of failures) {
    lines.push(`### ${test.suite} > ${test.name}\n`);
    if (test.error) {
      lines.push('```');
      lines.push(test.error);
      lines.push('```\n');
    }
    const failedEvals = test.evaluatorResults.filter((e) => !e.pass);
    if (failedEvals.length > 0) {
      lines.push('| Evaluator | Score | Explanation |');
      lines.push('|-----------|------:|-------------|');
      for (const ev of failedEvals) {
        lines.push(
          `| ${escapeCell(ev.evaluator)} | ${ev.score.toFixed(2)} | ${escapeCell(ev.explanation ?? '—')} |`,
        );
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function confidenceIntervalsSection(result: RunResult): string {
  if (!result.confidenceIntervals) return '';
  const ci = result.confidenceIntervals;
  const lines: string[] = [];

  lines.push('## Confidence Intervals (95%)\n');

  if (ci.overall.sampleSize > 1) {
    lines.push(
      `**Overall:** ${ci.overall.mean.toFixed(3)} ` +
        `[${ci.overall.lowerBound.toFixed(3)}, ${ci.overall.upperBound.toFixed(3)}] ` +
        `(n=${ci.overall.sampleSize}, σ=${ci.overall.stddev.toFixed(3)})\n`,
    );
  }

  const evalNames = Object.keys(ci.byEvaluator);
  if (evalNames.length > 0) {
    lines.push('### By Evaluator\n');
    lines.push('| Evaluator | Mean | CI Lower | CI Upper | σ | n |');
    lines.push('|-----------|-----:|---------:|---------:|--:|--:|');
    for (const name of evalNames) {
      const e = ci.byEvaluator[name];
      lines.push(
        `| ${escapeCell(name)} | ${e.mean.toFixed(3)} | ${e.lowerBound.toFixed(3)} | ${e.upperBound.toFixed(3)} | ${e.stddev.toFixed(3)} | ${e.sampleSize} |`,
      );
    }
    lines.push('');
  }

  const modelNames = Object.keys(ci.byModel);
  if (modelNames.length > 0) {
    lines.push('### By Model\n');
    lines.push('| Model | Mean | CI Lower | CI Upper | σ | n |');
    lines.push('|-------|-----:|---------:|---------:|--:|--:|');
    for (const name of modelNames) {
      const m = ci.byModel[name];
      lines.push(
        `| ${escapeCell(name)} | ${m.mean.toFixed(3)} | ${m.lowerBound.toFixed(3)} | ${m.upperBound.toFixed(3)} | ${m.stddev.toFixed(3)} | ${m.sampleSize} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function generateMarkdownReport(result: RunResult): string {
  const sections: string[] = [];

  sections.push(`# Eval Report: ${result.runId}\n`);
  sections.push(`- **Timestamp:** ${result.timestamp}`);
  sections.push(`- **Config:** \`${result.config}\``);
  sections.push(
    `- **Overall:** ${result.overall.passed}/${result.overall.total} passed (${(result.overall.passRate * 100).toFixed(1)}%) in ${formatDuration(result.overall.duration)}\n`,
  );

  sections.push('## Suite Summary\n');
  sections.push(suiteTable(result.suites));
  sections.push('');

  for (const suite of result.suites) {
    sections.push(`## ${suite.name} (${suite.layer})\n`);

    const hasDifficulty = suite.tests.some((t) => (t as { difficulty?: Difficulty }).difficulty);

    if (hasDifficulty) {
      const groups = new Map<string, TestResult[]>();
      for (const t of suite.tests) {
        const diff = (t as { difficulty?: Difficulty }).difficulty ?? 'untagged';
        const arr = groups.get(diff);
        if (arr) arr.push(t);
        else groups.set(diff, [t]);
      }
      for (const [diff, tests] of groups) {
        sections.push(`### ${diff.charAt(0).toUpperCase() + diff.slice(1)}\n`);
        sections.push(testTable(tests));
        sections.push('');
      }
    } else {
      sections.push(testTable(suite.tests));
      sections.push('');
    }

    const evalTable = evaluatorScoreTable(suite);
    if (evalTable) {
      sections.push('### Evaluator Scores\n');
      sections.push(evalTable);
      sections.push('');
    }
  }

  const failures = failureDetails(result);
  if (failures) {
    sections.push(failures);
  }

  const ciSection = confidenceIntervalsSection(result);
  if (ciSection) {
    sections.push(ciSection);
  }

  sections.push('---');
  sections.push(`*Generated by cursor-plugin-evals at ${result.timestamp}*`);
  sections.push('');

  return sections.join('\n');
}
