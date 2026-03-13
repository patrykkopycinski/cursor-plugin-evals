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
    '  judge_model: gpt-4o',
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
  .command('generate')
  .description('[deprecated] Use "init" instead — scaffold a plugin-eval.yaml config template')
  .option('-c, --config <path>', 'output path for generated config', './plugin-eval.yaml')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(generateCommand);

program
  .command('setup')
  .description('Interactive setup wizard — checks prerequisites, fixes issues, and guides you to your first eval run')
  .option('-d, --dir <path>', 'plugin directory', '.')
  .option('--skip-docker', 'skip Docker checks')
  .option('--no-interactive', 'skip auto-fix prompts')
  .option('--verbose', 'debug logging')
  .option('--no-color', 'disable colors')
  .action(async (opts: {
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
  });

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
  .description('Re-score recorded eval outputs against current evaluators (no LLM or cluster needed)')
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

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    log.error('Fatal error', err);
    process.exitCode = EXIT_CONFIG_ERROR;
  }
}

main();
