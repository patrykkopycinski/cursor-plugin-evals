import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { log, setLogLevel, setNoColor } from '../logger.js';
import { EXIT_FAIL, EXIT_CONFIG_ERROR, EXIT_OK, parsePositiveInt } from './helpers.js';

export function registerSecurityCommands(program: Command): void {
  program
    .command('security-lint')
    .description('Run static security checks against skill files')
    .option('-d, --dir <path>', 'plugin directory to scan', '.')
    .option('--skill <name>', 'check a single skill directory')
    .option('--report <format>', 'output format: terminal, json', 'terminal')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        dir: string;
        skill?: string;
        report: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Security Lint');

        const { runSkillSecurityChecks, runAllSkillSecurityChecks, formatSecurityReport } =
          await import('../../analyzers/security-lint.js');

        try {
          if (opts.skill) {
            const skillDir = resolve(process.cwd(), opts.dir, opts.skill);
            const report = await runSkillSecurityChecks(skillDir);
            if (opts.report === 'json') {
              console.log(JSON.stringify(report, null, 2));
            } else {
              console.log(formatSecurityReport([report]));
            }
            if (!report.passed) process.exitCode = EXIT_FAIL;
          } else {
            const reports = await runAllSkillSecurityChecks(resolve(process.cwd(), opts.dir));
            if (reports.length === 0) {
              log.info('No skills found.');
              return;
            }
            if (opts.report === 'json') {
              console.log(JSON.stringify(reports, null, 2));
            } else {
              console.log(formatSecurityReport(reports));
            }
            if (reports.some((r) => !r.passed)) process.exitCode = EXIT_FAIL;
          }
        } catch (err) {
          log.error('Security lint failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );

  program
    .command('lint-tools')
    .description('Validate SCRIPT_TO_TOOL mapping coverage against actual script files')
    .requiredOption('-d, --scripts-dir <path>', 'directory containing tool scripts')
    .option('--mapping-file <path>', 'JSON file with script-to-tool mapping (default: uses built-in)')
    .option('--extensions <exts...>', 'file extensions to scan', ['.js', '.sh', '.ts'])
    .option('--ignore <names...>', 'directory/file names to ignore', ['node_modules', '.git'])
    .option('--report <format>', 'output format: terminal, json', 'terminal')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        scriptsDir: string;
        mappingFile?: string;
        extensions: string[];
        ignore: string[];
        report: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Lint Tools');

        const { lintToolMappings, formatLintToolsReport } = await import(
          '../../utils/lint-tools.js'
        );

        let mapping: Record<string, string> = {};
        if (opts.mappingFile) {
          const { readFileSync } = await import('fs');
          mapping = JSON.parse(readFileSync(resolve(process.cwd(), opts.mappingFile), 'utf-8'));
        }

        const result = await lintToolMappings({
          scriptsDir: resolve(process.cwd(), opts.scriptsDir),
          mapping,
          extensions: opts.extensions,
          ignore: opts.ignore,
        });

        if (opts.report === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatLintToolsReport(result));
        }

        process.exitCode = result.pass ? EXIT_OK : EXIT_FAIL;
      },
    );

  program
    .command('red-team')
    .description('Run automated adversarial security scanning against the plugin')
    .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
    .option(
      '--categories <cats...>',
      'attack categories (jailbreak, prompt-injection, pii-leakage, bias, toxicity, excessive-agency, hallucination-probe, data-exfiltration, privilege-escalation, denial-of-service)',
    )
    .option('--count <n>', 'prompts per category', parsePositiveInt, 5)
    .option('-m, --model <model>', 'LLM model to use')
    .option('--report <format>', 'output format: terminal, json', 'terminal')
    .option('-o, --output <path>', 'write report to file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        config: string;
        categories?: string[];
        count: number;
        model?: string;
        report: string;
        output?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Red Team — Adversarial Security Scan');

        let config;
        try {
          config = loadConfig(opts.config);
        } catch (err) {
          log.error('Configuration error', err);
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        try {
          const { runRedTeam, formatRedTeamReport: fmtReport } = await import('../../red-team/index.js');

          const report = await runRedTeam({
            plugin: config.plugin,
            categories: opts.categories as import('../../red-team/types.js').AttackCategory[] | undefined,
            countPerCategory: opts.count,
            model: opts.model ?? config.defaults?.judgeModel,
          });

          if (opts.report === 'json') {
            const json = JSON.stringify(report, null, 2);
            console.log(json);
            if (opts.output) writeFileSync(resolve(process.cwd(), opts.output), json, 'utf-8');
          } else {
            const formatted = fmtReport(report);
            console.log(formatted);
            if (opts.output) writeFileSync(resolve(process.cwd(), opts.output), formatted, 'utf-8');
          }

          if (report.failed > 0) process.exitCode = EXIT_FAIL;
        } catch (err) {
          log.error('Red team scan failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );
}
