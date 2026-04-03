import { resolve, dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { mergeReports } from '../../reporting/merge.js';
import { generateJsonReport } from '../../reporting/json.js';
import { generateMarkdownReport } from '../../reporting/markdown.js';
import { discoverPlugin } from '../../plugin/discovery.js';
import { listCollections } from '../../core/collections.js';
import type { RunResult } from '../../core/types.js';
import { log, setLogLevel, setNoColor } from '../logger.js';
import { EXIT_FAIL, EXIT_CONFIG_ERROR, parsePositiveInt } from './helpers.js';
import { formatReport } from './run.js';

export function registerAnalysisCommands(program: Command): void {
  program
    .command('merge-reports')
    .description('Merge JSON reports from sharded CI runs into a single report')
    .argument('<files...>', 'JSON report files to merge (supports globs)')
    .option('-o, --output <path>', 'output merged report file')
    .option('--ci', 'enforce CI thresholds on merged result')
    .option('-c, --config <path>', 'config file path (required with --ci)', './plugin-eval.yaml')
    .option('--report <format>', 'output format', 'terminal')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (
        files: string[],
        opts: {
          output?: string;
          ci?: boolean;
          config: string;
          report: string;
          verbose?: boolean;
          noColor?: boolean;
        },
      ) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        const { readFileSync, readdirSync, statSync } = await import('fs');

        const resolvedFiles: string[] = [];
        for (const pattern of files) {
          const absPattern = resolve(process.cwd(), pattern);
          try {
            const stat = statSync(absPattern);
            if (stat.isFile()) {
              resolvedFiles.push(absPattern);
            }
          } catch (_e) {
            // Not a direct file — treat as a directory glob or skip
            log.warn(`File not found: ${pattern}`);
          }
        }

        if (resolvedFiles.length === 0) {
          log.error('No report files matched the provided patterns');
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        log.header('Merge Reports');
        log.info(`  Merging ${resolvedFiles.length} report file(s)`);

        const reports: RunResult[] = [];
        for (const file of resolvedFiles) {
          try {
            const raw = readFileSync(file, 'utf-8');
            reports.push(JSON.parse(raw) as RunResult);
          } catch (err) {
            log.error(`Failed to read ${file}`, err);
            process.exitCode = EXIT_CONFIG_ERROR;
            return;
          }
        }

        const merged = mergeReports(reports);

        if (opts.ci) {
          try {
            const config = loadConfig(opts.config);
            if (config.ci) {
              const { evaluateCi } = await import('../../ci/index.js');
              const allTests = merged.suites.flatMap((s) => s.tests);
              merged.ciResult = evaluateCi(allTests, config.ci, {
                firstTryPassRate: merged.overall.passRate,
                derivedMetrics: merged.derivedMetrics,
              });
            }
          } catch (err) {
            log.error('Configuration error', err);
            process.exitCode = EXIT_CONFIG_ERROR;
            return;
          }
        }

        const report = formatReport(merged, opts.report);
        if (report !== null) {
          console.log(report);
        }

        if (opts.output) {
          const outPath = resolve(process.cwd(), opts.output);
          mkdirSync(dirname(outPath), { recursive: true });
          const outputContent = report ?? generateJsonReport(merged);
          writeFileSync(outPath, outputContent, 'utf-8');
          log.success(`Merged report written to ${outPath}`);
        }

        if (opts.ci && merged.ciResult && !merged.ciResult.passed) {
          log.error(merged.ciResult.summary);
          process.exitCode = EXIT_FAIL;
        }
      },
    );

  program
    .command('discover')
    .description('Discover all components in a Cursor plugin directory')
    .option('-d, --dir <path>', 'plugin directory', '.')
    .option('--plugin-root <path>', 'path to plugin root relative to dir')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: { dir: string; pluginRoot?: string; verbose?: boolean; noColor?: boolean }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Discover — Plugin Components');

        try {
          const absDir = resolve(process.cwd(), opts.dir);
          const manifest = discoverPlugin(absDir, opts.pluginRoot);

          log.info(`Plugin: ${manifest.name}${manifest.version ? ` v${manifest.version}` : ''}`);
          if (manifest.description) log.info(`  ${manifest.description}`);
          console.log();

          const sections: Array<{ label: string; items: Array<{ name: string; detail: string }> }> = [
            {
              label: 'Skills',
              items: manifest.skills.map((s) => ({
                name: s.name || '(unnamed)',
                detail: s.description?.slice(0, 80) || '',
              })),
            },
            {
              label: 'Rules',
              items: manifest.rules.map((r) => ({
                name: r.path,
                detail: r.description?.slice(0, 80) || '',
              })),
            },
            {
              label: 'Agents',
              items: manifest.agents.map((a) => ({
                name: a.name || '(unnamed)',
                detail: a.description?.slice(0, 80) || '',
              })),
            },
            {
              label: 'Commands',
              items: manifest.commands.map((c) => ({
                name: c.name || c.path,
                detail: c.description?.slice(0, 80) || '',
              })),
            },
            {
              label: 'Hooks',
              items: manifest.hooks.map((h) => ({
                name: h.event,
                detail: `${h.handlers.length} handler(s)`,
              })),
            },
            {
              label: 'MCP Servers',
              items: manifest.mcpServers.map((m) => ({
                name: m.name,
                detail: m.url ?? m.command ?? '',
              })),
            },
          ];

          for (const section of sections) {
            log.info(`${section.label} (${section.items.length}):`);
            if (section.items.length === 0) {
              log.info('  (none)');
            } else {
              for (const item of section.items) {
                log.info(`  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
              }
            }
            console.log();
          }
        } catch (err) {
          log.error('Discovery failed', err);
          process.exitCode = EXIT_CONFIG_ERROR;
        }
      },
    );

  program
    .command('coverage')
    .description('Analyze test coverage for a plugin and report gaps')
    .option('-c, --config <path>', 'path to plugin-eval.yaml', 'plugin-eval.yaml')
    .option('--report <format>', 'output format: terminal, markdown, json, badge', 'terminal')
    .option('-o, --output <path>', 'write report to file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        config: string;
        report: string;
        output?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Coverage Analysis');

        try {
          const { analyzeCoverage } = await import('../../coverage/analyzer.js');
          const {
            formatCoverageTerminal,
            formatCoverageMarkdown,
            formatCoverageJson,
            generateCoverageBadge,
          } = await import('../../coverage/formatter.js');

          const configAbsPath = resolve(process.cwd(), opts.config);
          const pluginDir = process.cwd();
          const report = analyzeCoverage(pluginDir, configAbsPath);

          let output: string;
          switch (opts.report) {
            case 'json':
              output = formatCoverageJson(report);
              break;
            case 'markdown':
              output = formatCoverageMarkdown(report);
              break;
            case 'badge':
              output = generateCoverageBadge(report);
              break;
            case 'terminal':
            default:
              output = formatCoverageTerminal(report);
              break;
          }

          console.log(output);

          if (opts.output) {
            const outPath = resolve(process.cwd(), opts.output);
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, output, 'utf-8');
            log.success(`Report written to ${outPath}`);
          }
        } catch (err) {
          log.error('Coverage analysis failed', err);
          process.exitCode = EXIT_CONFIG_ERROR;
        }
      },
    );

  program
    .command('collections')
    .description('List available community test collections')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(async (opts: { verbose?: boolean; noColor?: boolean }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      log.header('Community Test Collections');

      const collections = listCollections();
      if (collections.length === 0) {
        log.info('No collections found.');
        return;
      }

      for (const col of collections) {
        log.info(`  ${col.name.padEnd(20)} ${col.testCount} test(s)`);
      }

      console.log();
      log.info('Use in plugin-eval.yaml:');
      log.info('  suites:');
      log.info('    - collection: filesystem');
    });

  program
    .command('collision-check')
    .description('Analyze skill routing collisions in a plugin directory')
    .option('-d, --dir <path>', 'skills directory', '.cursor-plugin/skills')
    .option('--report <format>', 'output format: terminal, json', 'terminal')
    .option('-o, --output <path>', 'write report to file')
    .option('--verbose', 'debug logging')
    .option('--no-color', 'disable colors')
    .action(
      async (opts: {
        dir: string;
        report: string;
        output?: string;
        verbose?: boolean;
        noColor?: boolean;
      }) => {
        if (opts.noColor) setNoColor(true);
        if (opts.verbose) setLogLevel('debug');

        log.header('Skill Collision Detection');

        const skillsDir = resolve(process.cwd(), opts.dir);
        log.info(`Scanning skills in: ${skillsDir}`);
        console.log();

        try {
          const { analyzeCollisions } = await import('../../analyzers/skill-collision.js');
          const report = await analyzeCollisions(skillsDir);

          if (opts.report === 'json') {
            const json = JSON.stringify(report, null, 2);
            console.log(json);
            if (opts.output) writeFileSync(resolve(process.cwd(), opts.output), json, 'utf-8');
            return;
          }

          log.info(`Found ${report.skills.length} skills`);
          console.log();

          if (report.errors.length > 0) {
            log.error(`${report.errors.length} HIGH collision(s):`);
            for (const pair of report.errors) {
              log.warn(
                `  ${pair.skillA} <-> ${pair.skillB}  (desc: ${pair.descriptionSimilarity.toFixed(2)}, tools: ${pair.toolOverlap.toFixed(2)})`,
              );
              log.info(`    ${pair.recommendation}`);
            }
            console.log();
          }

          if (report.warnings.length > 0) {
            log.warn(`${report.warnings.length} moderate collision(s):`);
            for (const pair of report.warnings) {
              log.info(
                `  ${pair.skillA} <-> ${pair.skillB}  (desc: ${pair.descriptionSimilarity.toFixed(2)}, tools: ${pair.toolOverlap.toFixed(2)})`,
              );
            }
            console.log();
          }

          log.success(`${report.clean.length} clean pair(s)`);

          if (report.errors.length > 0) {
            process.exitCode = EXIT_FAIL;
          }
        } catch (err) {
          log.error('Collision detection failed', err);
          process.exitCode = EXIT_FAIL;
        }
      },
    );
}
