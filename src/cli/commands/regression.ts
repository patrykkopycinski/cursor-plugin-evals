import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { runEvaluation } from '../../core/runner.js';
import { printTerminalReport } from '../../reporting/terminal.js';
import { DATA_DIR } from '../../core/constants.js';
import type { RunResult } from '../../core/types.js';
import { log, setLogLevel, setNoColor } from '../logger.js';
import { EXIT_FAIL, EXIT_CONFIG_ERROR, parsePositiveInt } from './helpers.js';

export function registerRegressionCommands(program: Command): void {
  program
    .command('regression')
    .description('Run evaluations and detect regressions against a baseline fingerprint')
    .requiredOption('--baseline <run-id>', 'baseline fingerprint run ID to compare against')
    .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
    .option('--alpha <number>', 'significance level for Welch t-test', parseFloat, 0.05)
    .option('-l, --layer <layers...>', 'filter layers')
    .option('-s, --suite <suites...>', 'filter suite names')
    .option('-r, --repeat <n>', 'override repetitions', parsePositiveInt)
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        baseline: string;
        config: string;
        alpha: number;
        layer?: string[];
        suite?: string[];
        repeat?: number;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Regression Detection');

        const { loadFingerprint, buildFingerprint, detectRegressions } =
          await import('../../regression/index.js');
        const { formatRegressionReport } = await import('../../regression/report.js');

        const baselineFp = await loadFingerprint(opts.baseline);
        if (!baselineFp) {
          log.error(`Baseline fingerprint not found: ${opts.baseline}`);
          log.info('Available fingerprints:');
          const { listFingerprints } = await import('../../regression/index.js');
          const ids = await listFingerprints();
          if (ids.length === 0) {
            log.info('  (none — run an evaluation first to create a baseline)');
          } else {
            for (const id of ids) log.info(`  ${id}`);
          }
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        let config;
        try {
          config = loadConfig(opts.config);
        } catch (err) {
          log.error('Configuration error', err);
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        let result: RunResult;
        try {
          result = await runEvaluation(config, {
            layers: opts.layer,
            suites: opts.suite,
            repeat: opts.repeat,
          });
        } catch (err) {
          log.error('Evaluation failed', err);
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        printTerminalReport(result);

        const allTests = result.suites.flatMap((s) => s.tests);
        const currentFp = buildFingerprint(result.runId, allTests);

        const regressions = detectRegressions(baselineFp, currentFp, opts.alpha);
        console.log(formatRegressionReport(regressions));

        const hasFail = regressions.some((r) => r.verdict === 'FAIL');
        if (hasFail) {
          process.exitCode = EXIT_FAIL;
        }
      },
    );

  program
    .command('compare')
    .description('Run evaluations across multiple models and produce a comparison matrix')
    .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
    .option('-m, --model <models...>', 'models to compare (at least 2)')
    .option('-l, --layer <layers...>', 'filter layers')
    .option('-s, --suite <suites...>', 'filter suites')
    .option('--report <format>', 'output format: terminal, json', 'terminal')
    .option('-o, --output <path>', 'write report to file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        config: string;
        model?: string[];
        layer?: string[];
        suite?: string[];
        report: string;
        output?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        const models = opts.model ?? [];
        if (models.length < 2) {
          log.error('Comparison requires at least 2 models (--model a --model b)');
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        log.header('Model A/B Comparison');
        log.info(`Models: ${models.join(', ')}`);
        console.log();

        let config;
        try {
          config = loadConfig(opts.config);
        } catch (err) {
          log.error('Configuration error', err);
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        try {
          const { buildComparisonFromRuns, formatComparisonTable } =
            await import('../../comparison/index.js');
          const runs: Array<{ model: { id: string; provider: string }; result: RunResult }> = [];

          for (const modelId of models) {
            log.info(`Running evaluation with model: ${modelId}`);
            const result = await runEvaluation(config, {
              layers: opts.layer,
              suites: opts.suite,
              models: [modelId],
            });
            runs.push({ model: { id: modelId, provider: 'openai' }, result });
          }

          const comparison = buildComparisonFromRuns(runs);

          if (opts.report === 'json') {
            const json = JSON.stringify(comparison, null, 2);
            console.log(json);
            if (opts.output) writeFileSync(resolve(process.cwd(), opts.output), json, 'utf-8');
            return;
          }

          console.log();
          console.log(formatComparisonTable(comparison));

          if (opts.output) {
            writeFileSync(
              resolve(process.cwd(), opts.output),
              formatComparisonTable(comparison),
              'utf-8',
            );
            log.success(`Comparison report written to ${opts.output}`);
          }
        } catch (err) {
          log.error('Comparison failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );

  program
    .command('history')
    .description('List past evaluation runs from Elasticsearch')
    .option('--skill <name>', 'filter by skill name')
    .option('--model <id>', 'filter by model')
    .option('--limit <n>', 'number of runs to show', '20')
    .option('--es-url <url>', 'Elasticsearch URL')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        skill?: string;
        model?: string;
        limit: string;
        esUrl?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');
        const { historyCommand } = await import('../history.js');
        await historyCommand({
          skill: opts.skill,
          model: opts.model,
          limit: parseInt(opts.limit, 10) || 20,
          esUrl: opts.esUrl,
        });
      },
    );

  program
    .command('replay')
    .description(
      'Re-score recorded eval outputs against current evaluators (no LLM or cluster needed)',
    )
    .requiredOption('--skill <name>', 'skill name to replay')
    .option('--run-id <id>', 'specific recording run ID (defaults to latest)')
    .option('--recordings-dir <path>', 'recordings directory', `${DATA_DIR}/recordings`)
    .option('-e, --evaluators <names...>', 'evaluators to run (defaults to all CODE evaluators)')
    .option('--judge <model>', 'judge model override for LLM evaluators')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        skill: string;
        runId?: string;
        recordingsDir: string;
        evaluators?: string[];
        judge?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');
        const { replayCommand } = await import('../replay.js');
        await replayCommand({
          skill: opts.skill,
          runId: opts.runId,
          recordingsDir: opts.recordingsDir,
          evaluators: opts.evaluators,
          judge: opts.judge,
        });
      },
    );

  program
    .command('prompt-sensitivity')
    .description('Analyze how sensitive LLM test results are to prompt rephrasings')
    .requiredOption('-s, --suite <name>', 'LLM suite name to analyze')
    .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
    .option('-n, --variants <n>', 'number of prompt variants to generate', parsePositiveInt, 5)
    .option('--threshold <n>', 'variance threshold for fragile classification', parseFloat, 0.15)
    .option('-o, --output <path>', 'write report to file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        suite: string;
        config: string;
        variants: number;
        threshold: number;
        output?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Prompt Sensitivity Analysis');

        let config;
        try {
          config = loadConfig(opts.config);
        } catch (err) {
          log.error('Configuration error', err);
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        try {
          const { analyzeSensitivity } = await import('../../prompt-sensitivity/analyzer.js');
          const { formatSensitivityReport } = await import('../../prompt-sensitivity/report.js');

          log.info(`Suite: ${opts.suite}, Variants: ${opts.variants}, Threshold: ${opts.threshold}`);
          console.log();

          const results = await analyzeSensitivity(config, opts.suite, opts.variants, opts.threshold);

          const report = formatSensitivityReport(results, opts.threshold);
          console.log(report);

          if (opts.output) {
            const outPath = resolve(process.cwd(), opts.output);
            writeFileSync(outPath, report, 'utf-8');
            log.success(`Report written to ${outPath}`);
          }

          const fragileCount = results.filter((r) => r.isFragile).length;
          if (fragileCount > 0) {
            process.exitCode = EXIT_FAIL;
          }
        } catch (err) {
          log.error('Prompt sensitivity analysis failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );
}
