import type { RunResult, SuiteResult, TestResult } from '../core/types.js';

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function msToSeconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function buildFailureElement(test: TestResult): string {
  const failedEvals = test.evaluatorResults.filter((e) => !e.pass);
  const parts: string[] = [];

  if (test.error) {
    parts.push(test.error);
  }

  for (const ev of failedEvals) {
    parts.push(`[${ev.evaluator}] score=${ev.score.toFixed(2)}${ev.explanation ? `: ${ev.explanation}` : ''}`);
  }

  const message = failedEvals.length > 0
    ? failedEvals.map((e) => `${e.evaluator}=${e.score.toFixed(2)}`).join(', ')
    : test.error ?? 'Test failed';

  const type = failedEvals.length > 0 ? 'evaluator' : 'error';

  return `      <failure message="${escXml(message)}" type="${escXml(type)}">${escXml(parts.join('\n'))}</failure>`;
}

function buildTestCase(test: TestResult, suite: SuiteResult): string {
  const classname = `${escXml(suite.name)}.${escXml(suite.layer)}`;
  const time = msToSeconds(test.latencyMs);

  if (test.pass) {
    return `    <testcase name="${escXml(test.name)}" classname="${classname}" time="${time}"/>`;
  }

  return `    <testcase name="${escXml(test.name)}" classname="${classname}" time="${time}">
${buildFailureElement(test)}
    </testcase>`;
}

function buildTestSuite(suite: SuiteResult): string {
  const failures = suite.tests.filter((t) => !t.pass).length;
  const time = msToSeconds(suite.duration);
  const testCases = suite.tests.map((t) => buildTestCase(t, suite)).join('\n');

  return `  <testsuite name="${escXml(suite.name)}" tests="${suite.tests.length}" failures="${failures}" time="${time}">
${testCases}
  </testsuite>`;
}

export function generateJunitXmlReport(result: RunResult): string {
  const suites = result.suites.map(buildTestSuite).join('\n');

  return `<?xml version="1.0"?>
<testsuites tests="${result.overall.total}" failures="${result.overall.failed}" time="${msToSeconds(result.overall.duration)}">
${suites}
</testsuites>`;
}
