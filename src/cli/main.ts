#!/usr/bin/env node

import { Command, InvalidArgumentError } from 'commander';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { loadConfig } from '../core/config.js';
import { runEvaluation } from '../core/runner.js';
import { printTerminalReport } from '../reporting/terminal.js';
import { generateMarkdownReport } from '../reporting/markdown.js';
import { generateJsonReport } from '../reporting/json.js';
import { generateHtmlReport } from '../reporting/html.js';
import { generateJunitXmlReport } from '../reporting/junit-xml.js';
import { discoverPlugin } from '../plugin/discovery.js';
import { generateBadgeSvg } from '../scoring/badge.js';
import { listCollections } from '../core/collections.js';
import type { RunResult } from '../core/types.js';
import { log, setLogLevel, setNoColor } from './logger.js';
import { watchAndRun } from './watch.js';
import { initCommand } from './init.js';
import { ciInitCommand } from './ci-init.js';
import { externalInitCommand, applyFixesCommand, generatePrFindings } from './external.js';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_CONFIG_ERROR = 2;

function parsePositiveInt(value: string): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new InvalidArgumentError('Must be a positive integer.');
  }
  return n;
}

function formatReport(result: RunResult, format: string): string | null {
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

async function runCommand(opts: {
  config: string;
  layer?: string[];
  suite?: string[];
  mock?: boolean;
  model?: string[];
  repeat?: number;
  report: string;
  output?: string;
  ci?: boolean;
  verbose?: boolean;
  noColor?: boolean;
  watch?: boolean;
}): Promise<void> {
  if (opts.noColor) setNoColor(true);
  if (opts.verbose) setLogLevel('debug');

  if (opts.watch) {
    try {
      await watchAndRun(opts.config, {
        layers: opts.layer,
        suites: opts.suite,
        mock: opts.mock,
        models: opts.model,
        repeat: opts.repeat,
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
      repeat: opts.repeat,
      ci: opts.ci,
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
    const outputContent = report ?? generateMarkdownReport(result);
    writeFileSync(outPath, outputContent, 'utf-8');
    log.success(`Report written to ${outPath}`);
  }

  if (opts.ci && result.overall.failed > 0) {
    process.exitCode = EXIT_FAIL;
  }

  if (result.qualityScore) {
    writeBadge(result);
  }
}

function writeBadge(result: RunResult): void {
  if (!result.qualityScore) return;
  const badgeDir = resolve(process.cwd(), '.cursor-plugin-evals', 'badges');
  mkdirSync(badgeDir, { recursive: true });
  const svg = generateBadgeSvg(result.qualityScore);
  const badgePath = resolve(badgeDir, 'quality.svg');
  writeFileSync(badgePath, svg, 'utf-8');
  log.debug(`Badge written to ${badgePath}`);
}

async function scoreCommand(opts: {
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
    log.success('Badge written to .cursor-plugin-evals/badges/quality.svg');
  }
}

async function doctorCommand(opts: { verbose?: boolean; noColor?: boolean }): Promise<void> {
  if (opts.noColor) setNoColor(true);
  if (opts.verbose) setLogLevel('debug');

  log.header('Doctor — Diagnostics');

  const checks: Array<{ label: string; ok: boolean; detail: string }> = [];

  // Docker check
  try {
    const { execSync } = await import('child_process');
    execSync('docker info', { stdio: 'pipe', timeout: 10_000 });
    checks.push({ label: 'Docker', ok: true, detail: 'Running' });
  } catch {
    checks.push({ label: 'Docker', ok: false, detail: 'Not running or not installed' });
  }

  // docker-compose check
  try {
    const { execSync } = await import('child_process');
    execSync('docker compose version', { stdio: 'pipe', timeout: 5_000 });
    checks.push({ label: 'Docker Compose', ok: true, detail: 'Available' });
  } catch {
    checks.push({ label: 'Docker Compose', ok: false, detail: 'Not available' });
  }

  // Node version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    label: 'Node.js',
    ok: major >= 20,
    detail: `${nodeVersion}${major < 20 ? ' (requires >= 20)' : ''}`,
  });

  // API key checks
  const apiKeys = [
    { name: 'OPENAI_API_KEY', label: 'OpenAI API Key' },
    { name: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key' },
    { name: 'AZURE_OPENAI_API_KEY', label: 'Azure OpenAI API Key' },
    { name: 'ES_API_KEY', label: 'Elasticsearch API Key' },
  ];
  for (const key of apiKeys) {
    const present = !!process.env[key.name];
    checks.push({
      label: key.label,
      ok: present,
      detail: present ? 'Set' : `${key.name} not set`,
    });
  }

  for (const check of checks) {
    if (check.ok) {
      log.success(`${check.label}: ${check.detail}`);
    } else {
      log.warn(`${check.label}: ${check.detail}`);
    }
  }

  const failures = checks.filter((c) => !c.ok);
  console.log();
  if (failures.length === 0) {
    log.success('All checks passed');
  } else {
    log.warn(`${failures.length} issue(s) found`);
  }
}

async function generateCommand(opts: {
  config: string;
  verbose?: boolean;
  noColor?: boolean;
}): Promise<void> {
  if (opts.noColor) setNoColor(true);
  if (opts.verbose) setLogLevel('debug');

  log.warn(
    '`generate` is deprecated — use `init` for interactive plugin discovery and config generation.',
  );
  log.header('Generate — Scaffold config');
  log.warn(
    'generate requires a running plugin. Set PLUGIN_DIR and ensure the plugin entry is correct.',
  );

  const template = [
    'plugin:',
    '  name: my-plugin',
    '  dir: ${PLUGIN_DIR}',
    '  entry: node dist/index.js',
    '  # plugin_root: .',
    '  # build_command: npm run build',
    '',
    'defaults:',
    '  timeout: 30000',
    '  repetitions: 3',
    '  judge_model: gpt-5.2',
    '  thresholds:',
    '    tool-selection: 0.8',
    '    tool-args: 0.7',
    '',
    'suites:',
    '  - name: plugin-structure',
    '    layer: static',
    '    tests:',
    '      - name: valid-manifest',
    '        check: manifest',
    '      - name: skill-metadata',
    '        check: skill_frontmatter',
    '      - name: rule-metadata',
    '        check: rule_frontmatter',
    '      - name: agent-metadata',
    '        check: agent_frontmatter',
    '      - name: command-metadata',
    '        check: command_frontmatter',
    '      - name: naming',
    '        check: naming_conventions',
    '      - name: coherence',
    '        check: cross_component_coherence',
    '',
    '  - name: unit-basics',
    '    layer: unit',
    '    tests:',
    '      - name: all-tools-register',
    '        check: registration',
    '',
    '  - name: integration-smoke',
    '    layer: integration',
    '    tests:',
    '      - name: sample-tool-call',
    '        tool: your_tool_name',
    '        args: {}',
    '',
    '  - name: llm-e2e',
    '    layer: llm',
    '    tests:',
    '      - name: basic-prompt',
    '        prompt: "What tools are available?"',
    '        expected:',
    '          tools: []',
    '        evaluators:',
    '          - tool-selection',
    '          - response-quality',
  ].join('\n');

  const outPath = resolve(process.cwd(), opts.config);
  writeFileSync(outPath, template, 'utf-8');
  log.success(`Config template written to ${outPath}`);
}

const program = new Command()
  .name('cursor-plugin-evals')
  .description(
    'End-to-end testing framework for Cursor plugins — static analysis, MCP tool testing, and LLM evaluation',
  )
  .version('0.0.1');

program
  .command('run', { isDefault: true })
  .description('Run evaluation suites')
  .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
  .option('-l, --layer <layers...>', 'filter layers (static, unit, integration, llm)')
  .option('-s, --suite <suites...>', 'filter suite names')
  .option('--mock', 'use recorded fixtures instead of live cluster')
  .option('-m, --model <models...>', 'override LLM models')
  .option('-r, --repeat <n>', 'override repetitions', parsePositiveInt)
  .option(
    '--report <format>',
    'output format: terminal, markdown, json, html, junit-xml',
    'terminal',
  )
  .option('-o, --output <path>', 'write report to file')
  .option('--ci', 'CI mode: enforce thresholds, exit non-zero on failure')
  .option('-w, --watch', 'watch mode: re-run on file changes')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(runCommand);

program
  .command('doctor')
  .description('Check environment and dependencies')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(doctorCommand);

program
  .command('init')
  .description('Interactive wizard to generate plugin-eval.yaml from a discovered plugin')
  .option('-d, --dir <path>', 'plugin directory', '.')
  .option('-o, --output <path>', 'output path for generated config', './plugin-eval.yaml')
  .option('--plugin-root <path>', 'path to plugin root relative to dir')
  .option('--transport <type>', 'transport type (stdio, http, sse, streamable-http)')
  .option('-l, --layers <layers...>', 'layers to generate (static, unit, integration, llm)')
  .option('--no-interactive', 'skip interactive prompts')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      dir: string;
      output: string;
      pluginRoot?: string;
      transport?: string;
      layers?: string[];
      interactive: boolean;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');
      await initCommand({
        dir: opts.dir,
        output: opts.output,
        pluginRoot: opts.pluginRoot,
        transport: opts.transport,
        layers: opts.layers,
        interactive: opts.interactive,
      });
    },
  );

program
  .command('external-init')
  .description('Create an evaluation workspace targeting an external plugin repo (no files written to the target)')
  .requiredOption('-e, --external <path>', 'path to the external plugin repository')
  .option('-s, --scope <subdir>', 'subdirectory scope within the plugin (e.g., skills/security)')
  .option('-o, --output <path>', 'output workspace directory (default: workspaces/<plugin-name>)')
  .option('--plugin-root <path>', 'path to plugin root relative to external dir')
  .option('--transport <type>', 'transport type (stdio, http, sse, streamable-http)')
  .option('-l, --layers <layers...>', 'layers to generate (static, unit, integration, llm, skill)')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      external: string;
      scope?: string;
      output?: string;
      pluginRoot?: string;
      transport?: string;
      layers?: string[];
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');
      await externalInitCommand(opts);
    },
  );

program
  .command('apply-fixes')
  .description('Apply skill/rule improvements from a workspace to the target repository')
  .requiredOption('-w, --workspace <path>', 'path to the evaluation workspace')
  .option('-t, --target <path>', 'override target directory (default: workspace\'s external dir)')
  .option('--dry-run', 'show what would be changed without writing files')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      workspace: string;
      target?: string;
      dryRun?: boolean;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');
      await applyFixesCommand(opts);
    },
  );

program
  .command('pr-findings')
  .description('Generate a PR-ready findings report from workspace evaluation results')
  .requiredOption('-w, --workspace <path>', 'path to the evaluation workspace')
  .option('-o, --output <path>', 'write report to file (default: stdout)')
  .option('--title <title>', 'custom PR title')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    (opts: {
      workspace: string;
      output?: string;
      title?: string;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      const wsDir = resolve(process.cwd(), opts.workspace);
      try {
        const report = generatePrFindings(wsDir, {
          workspace: wsDir,
          title: opts.title,
        });

        if (opts.output) {
          const outPath = resolve(process.cwd(), opts.output);
          mkdirSync(dirname(outPath), { recursive: true });
          writeFileSync(outPath, report, 'utf-8');
          log.success(`PR findings written to ${outPath}`);
        } else {
          process.stdout.write(report);
        }
      } catch (err) {
        log.error('Failed to generate PR findings', err);
        process.exitCode = EXIT_CONFIG_ERROR;
      }
    },
  );

program
  .command('generate')
  .description('[deprecated] Use "init" instead — scaffold a plugin-eval.yaml config template')
  .option('-c, --config <path>', 'output path for generated config', './plugin-eval.yaml')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(generateCommand);

program
  .command('setup')
  .description(
    'Interactive setup wizard — checks prerequisites, fixes issues, and guides you to your first eval run',
  )
  .option('-d, --dir <path>', 'plugin directory', '.')
  .option('--skip-docker', 'skip Docker checks')
  .option('--no-interactive', 'skip auto-fix prompts')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      dir: string;
      skipDocker?: boolean;
      interactive: boolean;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');
      const { setupCommand } = await import('./setup.js');
      await setupCommand({
        dir: opts.dir,
        interactive: opts.interactive,
        skipDocker: opts.skipDocker,
        verbose: opts.verbose,
      });
    },
  );

program
  .command('score')
  .description('Run all suites and display quality score')
  .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(scoreCommand);

program
  .command('ci-init')
  .description('Scaffold CI pipeline configuration for plugin evaluation')
  .option('--preset <type>', 'CI preset: github, gitlab, shell')
  .option('-o, --output <path>', 'output file path')
  .option('--no-interactive', 'skip interactive prompts')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      preset?: string;
      output?: string;
      interactive: boolean;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');
      await ciInitCommand({
        preset: opts.preset as 'github' | 'gitlab' | 'shell' | undefined,
        output: opts.output,
        interactive: opts.interactive,
      });
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
  .command('dashboard')
  .description('Start the web dashboard to browse evaluation results')
  .option('-p, --port <port>', 'server port', parsePositiveInt, 6280)
  .option('--no-open', 'skip opening browser')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(async (opts: { port: number; open: boolean; verbose?: boolean; noColor?: boolean }) => {
    if (opts.noColor) setNoColor(true);
    if (opts.verbose) setLogLevel('debug');

    const { resolve } = await import('path');
    const dbPath = resolve(process.cwd(), '.cursor-plugin-evals', 'dashboard.db');
    const { createApp } = await import('../dashboard/server.js');
    const { serve } = await import('@hono/node-server');

    const { app } = createApp(dbPath);
    const url = `http://localhost:${opts.port}`;

    log.header('Dashboard');
    log.info(`  Starting on ${url}`);

    serve({ fetch: app.fetch, port: opts.port }, async () => {
      log.success(`Dashboard running at ${url}`);

      if (opts.open) {
        try {
          const openModule = await import('open');
          await openModule.default(url);
        } catch {
          log.debug('Could not auto-open browser');
        }
      }
    });
  });

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
  .command('mock-gen')
  .description('Generate a standalone mock MCP server from recorded fixtures')
  .requiredOption('--fixture-dir <path>', 'directory containing .jsonl.gz fixture files')
  .requiredOption('-o, --output <path>', 'output path for generated .mjs file')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: { fixtureDir: string; output: string; verbose?: boolean; noColor?: boolean }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      const { generateMockServer } = await import('../fixtures/mock-gen.js');
      const fixtureDir = resolve(process.cwd(), opts.fixtureDir);
      const output = resolve(process.cwd(), opts.output);

      log.header('Mock Server Generation');
      log.info(`  Fixtures: ${fixtureDir}`);
      log.info(`  Output:   ${output}`);
      console.log();

      try {
        await generateMockServer(fixtureDir, output);
        log.success(`Mock server generated at ${output}`);
        log.info('Run with: node ' + output);
      } catch (err) {
        log.error('Mock generation failed', err);
        process.exitCode = EXIT_CONFIG_ERROR;
      }
    },
  );

program
  .command('skill-eval')
  .description('Run skill-level evaluations using eval.yaml datasets')
  .requiredOption('--skill-dir <path>', 'directory containing SKILL.md and eval.yaml')
  .option('-c, --config <path>', 'config file path for plugin connection', './plugin-eval.yaml')
  .option(
    '-a, --adapter <adapters...>',
    'adapter(s) to use (mcp, plain-llm, headless-coder, gemini-cli, claude-sdk)',
  )
  .option('-e, --evaluators <evaluators...>', 'evaluators to run')
  .option('-r, --repeat <n>', 'repetitions per example', parsePositiveInt)
  .option('--report <format>', 'output format: terminal, markdown, json', 'terminal')
  .option('-o, --output <path>', 'write report to file')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      skillDir: string;
      config: string;
      adapter?: string[];
      evaluators?: string[];
      repeat?: number;
      report: string;
      output?: string;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      log.header('Skill Evaluation');

      let config;
      try {
        config = loadConfig(opts.config);
      } catch (err) {
        log.error('Configuration error', err);
        process.exitCode = EXIT_CONFIG_ERROR;
        return;
      }

      const skillDir = resolve(process.cwd(), opts.skillDir);
      const syntheticSuite = {
        name: `skill:${opts.skillDir}`,
        layer: 'skill' as const,
        tests: [],
        defaults: {
          timeout: config.defaults?.timeout ?? 120_000,
          repetitions: opts.repeat ?? config.defaults?.repetitions ?? 1,
          judgeModel: config.defaults?.judgeModel,
          thresholds: config.defaults?.thresholds ?? {},
        },
        adapter: opts.adapter,
        skillDir,
      };

      try {
        const { runSkillSuite } = await import('../layers/skill/index.js');
        const { createEvaluator } = await import('../evaluators/index.js');

        const evalNames = opts.evaluators ?? ['correctness', 'groundedness'];
        const evaluatorRegistry = new Map<string, import('../core/types.js').Evaluator>();
        for (const name of evalNames) {
          evaluatorRegistry.set(name, createEvaluator(name as any));
        }

        const tests = await runSkillSuite(
          syntheticSuite as any,
          config.plugin,
          syntheticSuite.defaults,
          evaluatorRegistry,
        );

        const passCount = tests.filter((t) => t.pass).length;
        const failCount = tests.filter((t) => !t.pass).length;
        const totalDuration = tests.reduce((s, t) => s + t.latencyMs, 0);

        const evaluatorSummary: Record<
          string,
          { mean: number; min: number; max: number; pass: number; total: number }
        > = {};
        for (const test of tests) {
          for (const er of test.evaluatorResults) {
            if (!evaluatorSummary[er.evaluator]) {
              evaluatorSummary[er.evaluator] = {
                mean: 0,
                min: Infinity,
                max: -Infinity,
                pass: 0,
                total: 0,
              };
            }
            const s = evaluatorSummary[er.evaluator];
            s.total++;
            s.mean += er.score;
            s.min = Math.min(s.min, er.score);
            s.max = Math.max(s.max, er.score);
            if (er.pass) s.pass++;
          }
        }
        for (const s of Object.values(evaluatorSummary)) {
          if (s.total > 0) s.mean /= s.total;
        }

        const result: RunResult = {
          runId: '',
          timestamp: new Date().toISOString(),
          config: opts.config,
          overall: {
            passed: passCount,
            failed: failCount,
            skipped: 0,
            total: tests.length,
            passRate: tests.length > 0 ? passCount / tests.length : 0,
            duration: totalDuration,
          },
          suites: [
            {
              name: syntheticSuite.name,
              layer: 'skill',
              tests,
              passRate: tests.length > 0 ? passCount / tests.length : 0,
              duration: totalDuration,
              evaluatorSummary,
            },
          ],
        };

        const report = formatReport(result, opts.report);
        if (report !== null) console.log(report);

        if (opts.output) {
          const outPath = resolve(process.cwd(), opts.output);
          const outputContent = report ?? generateMarkdownReport(result);
          writeFileSync(outPath, outputContent, 'utf-8');
          log.success(`Report written to ${outPath}`);
        }
      } catch (err) {
        log.error('Skill evaluation failed', err);
        process.exitCode = EXIT_FAIL;
      }
    },
  );

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
        const { analyzeCollisions } = await import('../analyzers/skill-collision.js');
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

program
  .command('replay')
  .description(
    'Re-score recorded eval outputs against current evaluators (no LLM or cluster needed)',
  )
  .requiredOption('--skill <name>', 'skill name to replay')
  .option('--run-id <id>', 'specific recording run ID (defaults to latest)')
  .option('--recordings-dir <path>', 'recordings directory', '.cursor-plugin-evals/recordings')
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
      const { replayCommand } = await import('./replay.js');
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
      const { historyCommand } = await import('./history.js');
      await historyCommand({
        skill: opts.skill,
        model: opts.model,
        limit: parseInt(opts.limit, 10) || 20,
        esUrl: opts.esUrl,
      });
    },
  );

program
  .command('env')
  .description('Show supported environment variables with current values')
  .option('--no-color', 'disable colors')
  .action(async (opts: { noColor?: boolean }) => {
    if (opts.noColor) setNoColor(true);
    const { envCommand } = await import('./env.js');
    envCommand();
  });

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
        await import('../analyzers/security-lint.js');

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
        '../utils/lint-tools.js'
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
        await import('../regression/index.js');
      const { formatRegressionReport } = await import('../regression/report.js');

      const baselineFp = await loadFingerprint(opts.baseline);
      if (!baselineFp) {
        log.error(`Baseline fingerprint not found: ${opts.baseline}`);
        log.info('Available fingerprints:');
        const { listFingerprints } = await import('../regression/index.js');
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
          await import('../comparison/index.js');
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
  .command('gen-tests')
  .description('Auto-generate integration tests from MCP tool schemas')
  .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
  .option('-t, --tool <name>', 'generate tests for a single tool')
  .option('--smart', 'use LLM-powered generation with personas and edge cases')
  .option('--personas <types...>', 'personas for smart mode (novice, expert, adversarial)')
  .option('--multilingual <langs...>', 'languages for smart mode (e.g. es de ja)')
  .option('-o, --output <path>', 'write generated YAML to file')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      config: string;
      tool?: string;
      smart?: boolean;
      personas?: string[];
      multilingual?: string[];
      output?: string;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      log.header('Generate Tests from Schemas');

      let config;
      try {
        config = loadConfig(opts.config);
      } catch (err) {
        log.error('Configuration error', err);
        process.exitCode = EXIT_CONFIG_ERROR;
        return;
      }

      try {
        const { McpPluginClient } = await import('../mcp/client.js');
        const { parseEntry } = await import('../core/utils.js');
        const { generateTestsFromSchema } = await import('../gen-tests/schema-walker.js');
        const { formatAsYaml } = await import('../gen-tests/formatter.js');

        const connectConfig: Parameters<typeof McpPluginClient.connect>[0] = {
          buildCommand: config.plugin.buildCommand,
          env: config.plugin.env,
        };

        if (config.plugin.transport && config.plugin.transport !== 'stdio') {
          connectConfig.transport = {
            type: config.plugin.transport,
            url: config.plugin.url,
            headers: config.plugin.headers,
          };
        } else if (config.plugin.entry) {
          const { command, args } = parseEntry(config.plugin.entry);
          connectConfig.command = command;
          connectConfig.args = args;
          connectConfig.cwd = config.plugin.dir;
        }

        const client = await McpPluginClient.connect(connectConfig);

        try {
          const tools = await client.listTools();
          const filtered = opts.tool ? tools.filter((t) => t.name === opts.tool) : tools;

          if (filtered.length === 0) {
            log.warn(opts.tool ? `Tool "${opts.tool}" not found` : 'No tools discovered');
            return;
          }

          log.info(`Generating tests for ${filtered.length} tool(s)...`);

          const allTests = filtered.flatMap((tool) =>
            generateTestsFromSchema(tool.name, tool.inputSchema as Record<string, unknown>),
          );

          let yaml: string;

          if (opts.smart) {
            log.info('Using LLM-powered smart generation...');
            const { generateSmartTests, formatSmartTestsAsYaml } =
              await import('../gen-tests/smart-gen.js');
            const smartTests = await generateSmartTests({
              tools: filtered as any,
              count: 5,
              personas: opts.personas as any,
              multilingual: opts.multilingual,
              edgeCases: true,
            });
            yaml = formatSmartTestsAsYaml(smartTests, config.plugin.name);
            log.info(`Generated ${smartTests.length} smart test(s)`);
          } else {
            yaml = formatAsYaml(allTests, config.plugin.name);
            log.info(`Generated ${allTests.length} schema-based test(s)`);
          }

          if (opts.output) {
            const outPath = resolve(process.cwd(), opts.output);
            writeFileSync(outPath, yaml, 'utf-8');
            log.success(`Tests written → ${outPath}`);
          } else {
            console.log(yaml);
          }
        } finally {
          await client.disconnect();
        }
      } catch (err) {
        log.error('Test generation failed', err);
        process.exitCode = EXIT_FAIL;
      }
    },
  );

program
  .command('trace-import')
  .description('Import OTel trace JSON and generate evaluation test definitions')
  .requiredOption('-f, --file <path>', 'OTel trace JSON file path')
  .option('--llm', 'generate LLM-layer tests from prompt spans')
  .option('-o, --output <path>', 'write generated YAML to file')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      file: string;
      llm?: boolean;
      output?: string;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      log.header('Trace Import');

      try {
        const { readFileSync } = await import('fs');
        const { parseOtelTrace } = await import('../trace-import/parser.js');
        const { generateTestsFromTrace } = await import('../trace-import/generator.js');

        const filePath = resolve(process.cwd(), opts.file);
        const raw = readFileSync(filePath, 'utf-8');
        const json = JSON.parse(raw);

        const trace = parseOtelTrace(json);
        log.info(`Parsed trace ${trace.traceId} with ${trace.spans.length} span(s)`);

        const yaml = generateTestsFromTrace(trace, { llm: opts.llm });

        if (opts.output) {
          const outPath = resolve(process.cwd(), opts.output);
          writeFileSync(outPath, yaml, 'utf-8');
          log.success(`Tests written to ${outPath}`);
        } else {
          console.log(yaml);
        }
      } catch (err) {
        log.error('Trace import failed', err);
        process.exitCode = EXIT_FAIL;
      }
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
        const { analyzeSensitivity } = await import('../prompt-sensitivity/analyzer.js');
        const { formatSensitivityReport } = await import('../prompt-sensitivity/report.js');

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

const registry = program
  .command('registry')
  .description('Browse, pull, and push evaluation suites from the community registry');

registry
  .command('list')
  .description('List available suites in the remote registry')
  .option('--url <registryUrl>', 'custom registry URL')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(async (opts: { url?: string; verbose?: boolean; noColor?: boolean }) => {
    if (opts.noColor) setNoColor(true);
    if (opts.verbose) setLogLevel('debug');

    log.header('Registry — Available Suites');

    try {
      const { fetchRegistry } = await import('../registry/index.js');
      const entries = await fetchRegistry(opts.url);

      if (entries.length === 0) {
        log.info('No suites found in the registry.');
        return;
      }

      for (const entry of entries) {
        log.info(`  ${entry.name.padEnd(24)} v${entry.version.padEnd(8)} [${entry.layer}]`);
        log.info(`    ${entry.description}`);
        log.info(`    by ${entry.author}`);
        console.log();
      }

      log.success(`${entries.length} suite(s) available`);
    } catch (err) {
      log.error('Failed to fetch registry', err);
      process.exitCode = EXIT_FAIL;
    }
  });

registry
  .command('pull <name>')
  .description('Download a suite YAML from the registry into collections/')
  .option('--url <registryUrl>', 'custom registry URL')
  .option('-o, --output <dir>', 'output directory for downloaded suite', './collections')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (
      name: string,
      opts: { url?: string; output: string; verbose?: boolean; noColor?: boolean },
    ) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      try {
        const { fetchRegistry, pullSuite } = await import('../registry/index.js');
        const entries = await fetchRegistry(opts.url);
        const entry = entries.find((e) => e.name === name);

        if (!entry) {
          log.error(`Suite "${name}" not found in registry`);
          log.info('Available suites:');
          for (const e of entries) {
            log.info(`  ${e.name}`);
          }
          process.exitCode = EXIT_FAIL;
          return;
        }

        const outDir = resolve(process.cwd(), opts.output);
        const path = await pullSuite(entry, outDir);
        log.success(`Downloaded ${entry.name} → ${path}`);
      } catch (err) {
        log.error('Failed to pull suite', err);
        process.exitCode = EXIT_FAIL;
      }
    },
  );

registry
  .command('push')
  .description('Package a suite YAML and output its registry metadata')
  .requiredOption('--suite <path>', 'path to suite YAML file')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(async (opts: { suite: string; verbose?: boolean; noColor?: boolean }) => {
    if (opts.noColor) setNoColor(true);
    if (opts.verbose) setLogLevel('debug');

    try {
      const { packageSuite } = await import('../registry/index.js');
      const suitePath = resolve(process.cwd(), opts.suite);
      const entry = packageSuite(suitePath);

      log.header('Registry — Package Suite');
      log.info('Add this entry to registry.json:\n');
      console.log(JSON.stringify(entry, null, 2));
    } catch (err) {
      log.error('Failed to package suite', err);
      process.exitCode = EXIT_FAIL;
    }
  });

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
        const { runRedTeam, formatRedTeamReport: fmtReport } = await import('../red-team/index.js');

        const report = await runRedTeam({
          plugin: config.plugin,
          categories: opts.categories as any,
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

program
  .command('optimize')
  .description('Optimize prompts and tool descriptions by iteratively evaluating variants')
  .requiredOption('-s, --suite <name>', 'suite name to optimize against')
  .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
  .option('-e, --evaluator <name>', 'target evaluator to maximize', 'tool-selection')
  .option('-i, --iterations <n>', 'max optimization iterations', parsePositiveInt, 5)
  .option('-n, --variants <n>', 'variants per iteration', parsePositiveInt, 3)
  .option('--target-score <n>', 'stop when this score is reached', parseFloat, 0.95)
  .option('-o, --output <path>', 'write optimized prompts to file')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      suite: string;
      config: string;
      evaluator: string;
      iterations: number;
      variants: number;
      targetScore: number;
      output?: string;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      log.header('Prompt Optimization');
      log.info(
        `Suite: ${opts.suite}, Evaluator: ${opts.evaluator}, Iterations: ${opts.iterations}`,
      );
      console.log();

      try {
        const { optimizePrompt } = await import('../prompt-optimization/optimizer.js');
        const { formatOptimizationReport } = await import('../prompt-optimization/report.js');

        let config;
        try {
          config = loadConfig(opts.config);
        } catch (err) {
          log.error('Configuration error', err);
          process.exitCode = EXIT_CONFIG_ERROR;
          return;
        }

        const result = await optimizePrompt(config, {
          suite: opts.suite,
          targetEvaluator: opts.evaluator,
          maxIterations: opts.iterations,
          variantsPerIteration: opts.variants,
          targetScore: opts.targetScore,
        });

        const report = formatOptimizationReport(result);
        console.log(report);

        if (opts.output) {
          const outPath = resolve(process.cwd(), opts.output);
          writeFileSync(outPath, report, 'utf-8');
          log.success(`Report written to ${outPath}`);
        }
      } catch (err) {
        log.error('Optimization failed', err);
        process.exitCode = EXIT_FAIL;
      }
    },
  );

program
  .command('gen-conversations')
  .description('Generate realistic multi-turn conversations with simulated users')
  .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
  .option('--persona <name>', 'user persona (novice, expert, adversarial, impatient)', 'novice')
  .option('--goal <description>', 'conversation goal for the simulated user')
  .option('--turns <n>', 'max turns per conversation', parsePositiveInt, 5)
  .option('--count <n>', 'number of conversations to generate', parsePositiveInt, 1)
  .option('-m, --model <model>', 'LLM model for user simulation')
  .option('-o, --output <path>', 'write generated YAML to file')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      config: string;
      persona: string;
      goal?: string;
      turns: number;
      count: number;
      model?: string;
      output?: string;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      log.header('Conversation Simulation');
      log.info(`Persona: ${opts.persona}, Turns: ${opts.turns}, Count: ${opts.count}`);
      console.log();

      if (!opts.goal) {
        log.error('--goal is required (e.g. --goal "Set up APM monitoring")');
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

      try {
        const { simulateConversation } = await import('../conversation-sim/simulator.js');
        const { formatAsConversationYaml } = await import('../conversation-sim/formatter.js');
        const { McpPluginClient } = await import('../mcp/client.js');
        const { parseEntry } = await import('../core/utils.js');

        const connectConfig: Parameters<typeof McpPluginClient.connect>[0] = {
          buildCommand: config.plugin.buildCommand,
          env: config.plugin.env,
        };

        if (config.plugin.transport && config.plugin.transport !== 'stdio') {
          connectConfig.transport = {
            type: config.plugin.transport,
            url: config.plugin.url,
            headers: config.plugin.headers,
          };
        } else if (config.plugin.entry) {
          const { command, args } = parseEntry(config.plugin.entry);
          connectConfig.command = command;
          connectConfig.args = args;
          connectConfig.cwd = config.plugin.dir;
        }

        const client = await McpPluginClient.connect(connectConfig);

        try {
          const mcpTools = await client.listTools();

          const conversations = [];
          for (let i = 0; i < opts.count; i++) {
            log.info(`Generating conversation ${i + 1}/${opts.count}...`);
            const conv = await simulateConversation({
              persona: opts.persona,
              goal: opts.goal,
              maxTurns: opts.turns,
              tools: mcpTools as any,
            });
            conversations.push(conv);
          }

          const yaml = formatAsConversationYaml(conversations, ['conversation-coherence']);
          if (opts.output) {
            const outPath = resolve(process.cwd(), opts.output);
            writeFileSync(outPath, yaml, 'utf-8');
            log.success(`Generated ${conversations.length} conversation(s) → ${outPath}`);
          } else {
            console.log(yaml);
          }
        } finally {
          await client.disconnect();
        }
      } catch (err) {
        log.error('Conversation simulation failed', err);
        process.exitCode = EXIT_FAIL;
      }
    },
  );

program
  .command('monitor')
  .description('Continuously score OTel traces and detect quality anomalies')
  .option('--port <n>', 'HTTP port for trace ingestion (if not using stdin)', parsePositiveInt)
  .option('--stdin', 'read OTel JSON lines from stdin')
  .option('-e, --evaluators <names...>', 'evaluators to run on each trace')
  .option('--window <n>', 'sliding window size for anomaly detection', parsePositiveInt, 100)
  .option('--z-threshold <n>', 'z-score threshold for anomaly alerts', parseFloat, 2.0)
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      port?: number;
      stdin?: boolean;
      evaluators?: string[];
      window: number;
      zThreshold: number;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      log.header('Production Monitor');

      try {
        const { consumeStdin, parseOtelJsonLine } = await import('../monitoring/consumer.js');
        const { createAnomalyDetector } = await import('../monitoring/anomaly.js');

        const detector = createAnomalyDetector(opts.window, opts.zThreshold);

        if (opts.stdin) {
          log.info('Reading OTel JSON lines from stdin...');
          let traceCount = 0;
          let anomalyCount = 0;

          for await (const event of consumeStdin()) {
            traceCount++;
            const latency = event.endTime - event.startTime;
            detector.addScore('latency', latency);

            if (detector.isAnomaly('latency', latency)) {
              anomalyCount++;
              log.warn(
                `ANOMALY: trace ${event.traceId} latency ${latency}ms (span: ${event.name})`,
              );
            }

            if (traceCount % 100 === 0) {
              const stats = detector.getStats('latency');
              log.info(
                `Processed ${traceCount} traces, ${anomalyCount} anomalies, mean latency: ${stats?.mean.toFixed(1) ?? 'N/A'}ms`,
              );
            }
          }

          log.success(`Done. Processed ${traceCount} traces, ${anomalyCount} anomalies.`);
        } else if (opts.port) {
          log.info(`Starting HTTP trace ingestion on port ${opts.port}...`);
          const { serve } = await import('@hono/node-server');
          const hono = await import('hono');
          const HonoApp = hono.Hono;

          const app = new HonoApp();
          let traceCount = 0;

          app.post('/v1/traces', async (c) => {
            const body = await c.req.text();
            const lines = body.split('\n').filter(Boolean);
            for (const line of lines) {
              const event = parseOtelJsonLine(line);
              if (event) {
                traceCount++;
                const latency = event.endTime - event.startTime;
                detector.addScore('latency', latency);
                if (detector.isAnomaly('latency', latency)) {
                  log.warn(`ANOMALY: trace ${event.traceId} latency ${latency}ms`);
                }
              }
            }
            return c.json({ status: 'ok', processed: lines.length });
          });

          app.get('/stats', (c) => {
            return c.json({
              traceCount,
              stats: detector.getStats('latency'),
            });
          });

          serve({ fetch: app.fetch, port: opts.port }, () => {
            log.success(
              `Monitor running on http://localhost:${opts.port} (POST /v1/traces, GET /stats)`,
            );
          });
        } else {
          log.error('Specify --stdin or --port <n>');
          process.exitCode = EXIT_CONFIG_ERROR;
        }
      } catch (err) {
        log.error('Monitor failed', err);
        process.exitCode = EXIT_FAIL;
      }
    },
  );

program
  .command('cost-report')
  .description('Analyze model comparison data and recommend cost optimizations')
  .option('-c, --config <path>', 'config file path', './plugin-eval.yaml')
  .option('-m, --model <models...>', 'models to compare (runs evals for each)')
  .option('-l, --layer <layers...>', 'filter layers')
  .option('-s, --suite <suites...>', 'filter suites')
  .option('--threshold <n>', 'minimum quality score threshold', parseFloat, 0.8)
  .option('-o, --output <path>', 'write report to file')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(
    async (opts: {
      config: string;
      model?: string[];
      layer?: string[];
      suite?: string[];
      threshold: number;
      output?: string;
      verbose?: boolean;
      noColor?: boolean;
    }) => {
      if (opts.noColor) setNoColor(true);
      if (opts.verbose) setLogLevel('debug');

      log.header('Cost Optimization Report');

      const models = opts.model ?? [];
      if (models.length < 2) {
        log.error('Cost report requires at least 2 models (--model a --model b)');
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

      try {
        const { analyzeCosts, formatCostReport: fmtCost } =
          await import('../cost-advisor/index.js');

        const comparisonData: Array<{
          testName: string;
          model: string;
          score: number;
          tokenUsage?: { input: number; output: number };
        }> = [];

        for (const modelId of models) {
          log.info(`Running evaluation with model: ${modelId}`);
          const result = await runEvaluation(config, {
            layers: opts.layer,
            suites: opts.suite,
            models: [modelId],
          });

          for (const suite of result.suites) {
            for (const test of suite.tests) {
              const avgScore =
                test.evaluatorResults.length > 0
                  ? test.evaluatorResults.reduce((s, e) => s + e.score, 0) /
                    test.evaluatorResults.length
                  : test.pass
                    ? 1
                    : 0;
              comparisonData.push({
                testName: `${suite.name}/${test.name}`,
                model: modelId,
                score: avgScore,
                tokenUsage: test.tokenUsage,
              });
            }
          }
        }

        const report = analyzeCosts(comparisonData, opts.threshold);
        const formatted = fmtCost(report);
        console.log(formatted);

        if (opts.output) {
          const outPath = resolve(process.cwd(), opts.output);
          writeFileSync(outPath, formatted, 'utf-8');
          log.success(`Report written to ${outPath}`);
        }
      } catch (err) {
        log.error('Cost analysis failed', err);
        process.exitCode = EXIT_FAIL;
      }
    },
  );

const datasetCmd = program.command('dataset').description('Manage versioned evaluation datasets');

datasetCmd
  .command('create <name>')
  .description('Create a new dataset')
  .option('--description <text>', 'dataset description', '')
  .action(async (name: string, opts: { description: string }) => {
    try {
      const { createDataset } = await import('../dataset/manager.js');
      const ds = await createDataset(name, opts.description);
      log.success(`Created dataset "${ds.name}" v${ds.version}`);
    } catch (err) {
      log.error('Failed to create dataset', err);
      process.exitCode = EXIT_FAIL;
    }
  });

datasetCmd
  .command('list')
  .description('List all datasets')
  .action(async () => {
    try {
      const { listDatasets } = await import('../dataset/manager.js');
      const datasets = await listDatasets();
      if (datasets.length === 0) {
        log.info('No datasets found.');
        return;
      }
      for (const ds of datasets) {
        log.info(
          `  ${ds.name.padEnd(24)} v${String(ds.version).padEnd(4)} ${ds.exampleCount} examples  ${ds.description}`,
        );
      }
    } catch (err) {
      log.error('Failed to list datasets', err);
      process.exitCode = EXIT_FAIL;
    }
  });

datasetCmd
  .command('add <dataset-name>')
  .description('Add an example to a dataset (reads JSON from stdin or --json)')
  .option('--json <data>', 'example JSON data')
  .action(async (datasetName: string, opts: { json?: string }) => {
    try {
      const { addExample } = await import('../dataset/manager.js');
      let example;
      if (opts.json) {
        example = JSON.parse(opts.json);
      } else {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        example = JSON.parse(Buffer.concat(chunks).toString());
      }
      await addExample(datasetName, example);
      log.success(`Added example to dataset "${datasetName}"`);
    } catch (err) {
      log.error('Failed to add example', err);
      process.exitCode = EXIT_FAIL;
    }
  });

datasetCmd
  .command('export <dataset-name>')
  .description('Export dataset as YAML suite format')
  .option('-o, --output <path>', 'write YAML to file')
  .action(async (datasetName: string, opts: { output?: string }) => {
    try {
      const { exportToYaml: dsExport } = await import('../dataset/manager.js');
      const yaml = await dsExport(datasetName);
      if (opts.output) {
        writeFileSync(resolve(process.cwd(), opts.output), yaml, 'utf-8');
        log.success(`Exported to ${opts.output}`);
      } else {
        console.log(yaml);
      }
    } catch (err) {
      log.error('Failed to export dataset', err);
      process.exitCode = EXIT_FAIL;
    }
  });

datasetCmd
  .command('version <dataset-name>')
  .description('Create a new version snapshot of a dataset')
  .action(async (datasetName: string) => {
    try {
      const { versionDataset } = await import('../dataset/manager.js');
      const snapshot = await versionDataset(datasetName);
      log.success(`Created version ${snapshot.version} of dataset "${datasetName}"`);
    } catch (err) {
      log.error('Failed to version dataset', err);
      process.exitCode = EXIT_FAIL;
    }
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    log.error('Fatal error', err);
    process.exitCode = EXIT_CONFIG_ERROR;
  }
}

main();
