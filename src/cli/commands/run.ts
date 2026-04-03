import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { runEvaluation } from '../../core/runner.js';
import { printTerminalReport } from '../../reporting/terminal.js';
import { generateMarkdownReport } from '../../reporting/markdown.js';
import { generateJsonReport } from '../../reporting/json.js';
import { generateHtmlReport } from '../../reporting/html.js';
import { generateJunitXmlReport } from '../../reporting/junit-xml.js';
import { generateBadgeSvg } from '../../scoring/badge.js';
import { DATA_DIR } from '../../core/constants.js';
import { parseShardArg } from '../../core/shard.js';
import type { RunResult } from '../../core/types.js';
import type { ShardConfig } from '../../core/shard.js';
import { log, setLogLevel, setNoColor } from '../logger.js';
import { watchAndRun } from '../watch.js';
import { resolveRepeatFromPreset } from '../presets.js';
import { executePostRunHooks } from '../../hooks/post-run.js';
import { EXIT_FAIL, EXIT_CONFIG_ERROR, parsePositiveInt } from './helpers.js';

export function formatReport(result: RunResult, format: string): string | null {
  switch (format) {
    case 'json':
      return generateJsonReport(result);
    case 'markdown':
      return generateMarkdownReport(result);
    case 'html':
      return generateHtmlReport(result);
    case 'junit-xml':
      return generateJunitXmlReport(result);
    case 'terminal':
    default:
      printTerminalReport(result);
      return null;
  }
}

export async function runCommand(opts: {
  config: string;
  layer?: string[];
  suite?: string[];
  mock?: boolean;
  model?: string[];
  repeat?: number;
  preset?: string;
  report: string;
  output?: string;
  ci?: boolean;
  verbose?: boolean;
  noColor?: boolean;
  watch?: boolean;
  lastFailed?: boolean;
  failedFirst?: boolean;
  shard?: ShardConfig;
}): Promise<void> {
  if (opts.noColor) setNoColor(true);
  if (opts.verbose) setLogLevel('debug');

  const repeat = opts.repeat ?? resolveRepeatFromPreset(opts.preset);

  if (opts.watch) {
    try {
      await watchAndRun(opts.config, {
        layers: opts.layer,
        suites: opts.suite,
        mock: opts.mock,
        models: opts.model,
        repeat,
        report: opts.report,
        verbose: opts.verbose,
      });
    } catch (err) {
      log.error('Watch mode failed', err);
      process.exitCode = EXIT_CONFIG_ERROR;
    }
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
      mock: opts.mock,
      models: opts.model,
      repeat,
      ci: opts.ci,
      lastFailed: opts.lastFailed,
      failedFirst: opts.failedFirst,
      shard: opts.shard,
    });
  } catch (err) {
    log.error('Evaluation failed', err);
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }

  const report = formatReport(result, opts.report);

  if (report !== null) {
    console.log(report);
  }

  if (opts.output) {
    const outPath = resolve(process.cwd(), opts.output);
    // Auto-detect format from extension when --report is terminal (default)
    const autoFormat = outPath.endsWith('.json') ? 'json' : outPath.endsWith('.html') ? 'html' : null;
    const outputContent = (autoFormat ? formatReport(result, autoFormat) : report) ?? generateMarkdownReport(result);
    writeFileSync(outPath, outputContent, 'utf-8');
    log.success(`Report written to ${outPath}`);
  }

  if (config.postRun && config.postRun.length > 0) {
    await executePostRunHooks(config.postRun, result);
  }

  if (opts.ci && result.overall.failed > 0) {
    process.exitCode = EXIT_FAIL;
  }

  if (opts.ci && result.ciResult && !result.ciResult.passed) {
    log.error(result.ciResult.summary);
    process.exitCode = EXIT_FAIL;
  }

  if (result.qualityScore) {
    writeBadge(result);
  }
}

export function writeBadge(result: RunResult): void {
  if (!result.qualityScore) return;
  const badgeDir = resolve(process.cwd(), DATA_DIR, 'badges');
  mkdirSync(badgeDir, { recursive: true });
  const svg = generateBadgeSvg(result.qualityScore);
  const badgePath = resolve(badgeDir, 'quality.svg');
  writeFileSync(badgePath, svg, 'utf-8');
  log.debug(`Badge written to ${badgePath}`);
}

export async function scoreCommand(opts: {
  config: string;
  verbose?: boolean;
  noColor?: boolean;
}): Promise<void> {
  if (opts.noColor) setNoColor(true);
  if (opts.verbose) setLogLevel('debug');

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
    result = await runEvaluation(config);
  } catch (err) {
    log.error('Evaluation failed', err);
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }

  printTerminalReport(result);

  if (result.qualityScore) {
    const qs = result.qualityScore;
    log.header('Quality Score');
    log.info(`  Grade: ${qs.grade}  Composite: ${qs.composite.toFixed(1)}%\n`);
    for (const [dim, score] of Object.entries(qs.dimensions)) {
      const pct = ((score as number) * 100).toFixed(1);
      const weight = qs.weights[dim];
      log.info(`    ${dim.padEnd(18)} ${pct}%  (weight: ${weight ?? 0})`);
    }
    console.log();

    writeBadge(result);
    log.success(`Badge written to ${DATA_DIR}/badges/quality.svg`);
  }
}

export function registerRunCommands(program: Command): void {
  program
    .command('run', { isDefault: true })
    .description('Run evaluation suites')
    .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
    .option('-l, --layer <layers...>', 'filter layers (static, unit, integration, llm)')
    .option('-s, --suite <suites...>', 'filter suite names')
    .option('--mock', 'use recorded fixtures instead of live cluster')
    .option('-m, --model <models...>', 'override LLM models')
    .option('-r, --repeat <n>', 'override repetitions', parsePositiveInt)
    .option('--preset <name>', 'trial preset: smoke (5), reliable (20), regression (50)')
    .option(
      '--report <format>',
      'output format: terminal, markdown, json, html, junit-xml',
      'terminal',
    )
    .option('-o, --output <path>', 'write report to file')
    .option('--ci', 'CI mode: enforce thresholds, exit non-zero on failure')
    .option('--lf, --last-failed', 'only re-run tests that failed in the last run')
    .option('--ff, --failed-first', 'run previously failed tests first, then the rest')
    .option('--shard <spec>', 'run only shard x of y (e.g. --shard 1/4)', parseShardArg)
    .option('-w, --watch', 'watch mode: re-run on file changes')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(runCommand);

  program
    .command('score')
    .description('Run all suites and display quality score')
    .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(scoreCommand);
}
