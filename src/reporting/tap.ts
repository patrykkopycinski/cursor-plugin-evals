import type { RunResult, TestResult } from '../core/types.js';

function buildDiagnostic(test: TestResult): string {
  const failedEvals = test.evaluatorResults.filter((e) => !e.pass);
  const parts: string[] = [];

  if (test.error) {
    parts.push(`error: ${test.error}`);
  }

  for (const ev of failedEvals) {
    parts.push(
      `${ev.evaluator}: score=${ev.score.toFixed(2)}${ev.explanation ? `, ${ev.explanation}` : ''}`,
    );
  }

  const message = parts.join('; ');
  const lines = ['  ---', `  message: "${message}"`, '  severity: fail', '  ...'];
  return lines.join('\n');
}

export function generateTapReport(result: RunResult): string {
  const lines: string[] = ['TAP version 14'];

  const allTests: Array<{ suite: string; test: TestResult }> = [];
  for (const suite of result.suites) {
    for (const test of suite.tests) {
      allTests.push({ suite: suite.name, test });
    }
  }

  lines.push(`1..${allTests.length}`);

  for (let i = 0; i < allTests.length; i++) {
    const { suite, test } = allTests[i];
    const num = i + 1;
    const label = `${suite}/${test.name}`;

    if (test.skipped) {
      const reason = test.error ?? 'skipped';
      lines.push(`ok ${num} - ${label} # SKIP ${reason}`);
      continue;
    }

    if (test.pass) {
      lines.push(`ok ${num} - ${label}`);
    } else {
      lines.push(`not ok ${num} - ${label}`);
      lines.push(buildDiagnostic(test));
    }
  }

  return lines.join('\n');
}
