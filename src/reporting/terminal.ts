import chalk from 'chalk';
import { log } from '../cli/logger.js';
import type { RunResult, SuiteResult, TestResult, Difficulty, DerivedMetricResult, TrialMetrics } from '../core/types.js';
import { formatDuration } from '../core/utils.js';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  simple: chalk.green('[simple]'),
  moderate: chalk.yellow('[moderate]'),
  complex: chalk.red('[complex]'),
  adversarial: chalk.magenta('[adversarial]'),
};

function difficultyTag(test: TestResult): string {
  const difficulty = (test as { difficulty?: Difficulty }).difficulty;
  if (!difficulty) return '';
  return ` ${DIFFICULTY_LABELS[difficulty]}`;
}

function printTestResult(test: TestResult): void {
  const status = test.skipped ? 'skip' : test.pass ? 'pass' : 'fail';
  log.test(test.name + difficultyTag(test), status);

  for (const ev of test.evaluatorResults) {
    if (ev.skipped) {
      log.evaluatorSkipped(ev.evaluator);
    } else {
      log.evaluator(ev.evaluator, ev.score, ev.pass);
    }
  }

  if (test.tokenUsage) {
    const { input, output, cached } = test.tokenUsage;
    const parts = [`in:${input}`, `out:${output}`];
    if (cached) parts.push(`cached:${cached}`);
    log.debug(`      tokens: ${parts.join(' | ')}`);
  }

  if (test.latencyMs > 0) {
    log.debug(`      latency: ${formatDuration(test.latencyMs)}`);
  }
}

function printSuiteResult(suite: SuiteResult): void {
  log.suite(suite.name, suite.layer);

  for (const test of suite.tests) {
    printTestResult(test);
  }

  const evalNames = Object.keys(suite.evaluatorSummary);
  if (evalNames.length > 0) {
    log.divider();
    const rows: string[][] = [['Evaluator', 'Mean', 'Min', 'Max', 'Pass']];
    for (const name of evalNames) {
      const s = suite.evaluatorSummary[name];
      rows.push([
        name,
        s.mean.toFixed(2),
        s.min.toFixed(2),
        s.max.toFixed(2),
        `${s.pass}/${s.total}`,
      ]);
    }
    log.table(rows);
  }

  const passRate = (suite.passRate * 100).toFixed(1);
  const skipped = suite.tests.filter((t) => t.skipped).length;
  const passed = suite.tests.filter((t) => t.pass && !t.skipped).length;
  const failed = suite.tests.length - passed - skipped;
  const parts = [`${passed} passed`, `${failed} failed`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  log.info(
    `    ${chalk.gray(`${passRate}% — ${parts.join(', ')} (${formatDuration(suite.duration)})`)}`,
  );
  log.info('');
}

function printFailureDetails(result: RunResult): void {
  const failures = result.suites.flatMap((s) => s.tests.filter((t) => !t.pass));
  if (failures.length === 0) return;

  log.header('Failure Details');

  for (const test of failures) {
    log.error(`${test.suite} > ${test.name}`);
    if (test.error) {
      log.info(`    ${chalk.gray(test.error)}`);
    }
    for (const ev of test.evaluatorResults.filter((e) => !e.pass)) {
      log.info(
        `    ${chalk.red('✗')} ${ev.evaluator}: ${ev.score.toFixed(2)}${ev.explanation ? ` — ${ev.explanation}` : ''}`,
      );
    }
    log.info('');
  }
}

function printConfidenceIntervals(result: RunResult): void {
  if (!result.confidenceIntervals) return;
  const ci = result.confidenceIntervals;

  log.divider();
  log.info(chalk.bold('  Confidence Intervals (95%)'));
  log.info('');

  if (ci.overall.sampleSize > 1) {
    log.info(
      `  Overall: ${ci.overall.mean.toFixed(3)} ` +
        chalk.gray(`[${ci.overall.lowerBound.toFixed(3)}, ${ci.overall.upperBound.toFixed(3)}]`) +
        chalk.gray(` (n=${ci.overall.sampleSize}, σ=${ci.overall.stddev.toFixed(3)})`),
    );
  }

  const evalNames = Object.keys(ci.byEvaluator);
  if (evalNames.length > 0) {
    const rows: string[][] = [['Evaluator', 'Mean', 'CI Lower', 'CI Upper', 'σ', 'n']];
    for (const name of evalNames) {
      const e = ci.byEvaluator[name];
      rows.push([
        name,
        e.mean.toFixed(3),
        e.lowerBound.toFixed(3),
        e.upperBound.toFixed(3),
        e.stddev.toFixed(3),
        String(e.sampleSize),
      ]);
    }
    log.table(rows);
  }

  const modelNames = Object.keys(ci.byModel);
  if (modelNames.length > 0) {
    log.info('');
    const rows: string[][] = [['Model', 'Mean', 'CI Lower', 'CI Upper', 'σ', 'n']];
    for (const name of modelNames) {
      const m = ci.byModel[name];
      rows.push([
        name,
        m.mean.toFixed(3),
        m.lowerBound.toFixed(3),
        m.upperBound.toFixed(3),
        m.stddev.toFixed(3),
        String(m.sampleSize),
      ]);
    }
    log.table(rows);
  }

  log.info('');
}

function printDerivedMetrics(metrics: DerivedMetricResult[]): void {
  log.divider();
  log.info(chalk.bold('  Derived Metrics'));
  log.info('');

  const rows: string[][] = [['Metric', 'Value', 'Threshold', 'Status']];
  for (const m of metrics) {
    const status = m.error
      ? chalk.red('ERROR')
      : m.pass
        ? chalk.green('PASS')
        : chalk.red('FAIL');
    rows.push([
      m.name,
      m.value.toFixed(3),
      m.threshold != null ? m.threshold.toFixed(3) : '—',
      status,
    ]);
    if (m.error) {
      log.info(`    ${chalk.gray(m.error)}`);
    }
  }
  log.table(rows);
  log.info('');
}

function printTrialMetrics(metrics: TrialMetrics): void {
  log.divider();
  log.info(chalk.bold('  Trial Metrics'));
  log.info(`  ${chalk.gray(`p = ${(metrics.perTrialSuccessRate * 100).toFixed(1)}% per-trial success rate`)}`);
  log.info('');

  const rows: string[][] = [['k', 'pass@k', 'pass^k']];
  for (const k of metrics.kValues) {
    rows.push([
      String(k),
      (metrics.passAtK[k] * 100).toFixed(1) + '%',
      (metrics.passHatK[k] * 100).toFixed(1) + '%',
    ]);
  }
  log.table(rows);
  log.info('');
}

export function printTerminalReport(result: RunResult): void {
  log.header(`Eval Run: ${result.runId}`);
  log.info(`  Config: ${result.config}`);
  log.info(`  Started: ${result.timestamp}`);
  log.info('');

  for (const suite of result.suites) {
    printSuiteResult(suite);
  }

  printFailureDetails(result);
  printConfidenceIntervals(result);

  if (result.trialMetrics) {
    printTrialMetrics(result.trialMetrics);
  }

  if (result.derivedMetrics?.length) {
    printDerivedMetrics(result.derivedMetrics);
  }

  log.summary(
    result.overall.total,
    result.overall.passed,
    result.overall.failed,
    result.overall.duration,
    result.overall.skipped,
  );
}
