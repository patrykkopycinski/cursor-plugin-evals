import { resolve, dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import type { Command } from 'commander';
import { log, setLogLevel, setNoColor } from '../logger.js';
import { initCommand } from '../init.js';
import { ciInitCommand } from '../ci-init.js';
import { externalInitCommand, applyFixesCommand, generatePrFindings } from '../external.js';
import { EXIT_CONFIG_ERROR } from './helpers.js';

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
    '  judge_model: gpt-5.4',
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

export function registerInfraCommands(program: Command): void {
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
        const { setupCommand } = await import('../setup.js');
        await setupCommand({
          dir: opts.dir,
          interactive: opts.interactive,
          skipDocker: opts.skipDocker,
          verbose: opts.verbose,
        });
      },
    );

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
    .command('env')
    .description('Show supported environment variables with current values')
    .option('--no-color', 'disable colors')
    .action(async (opts: { noColor?: boolean }) => {
      if (opts.noColor) setNoColor(true);
      const { envCommand } = await import('../env.js');
      envCommand();
    });
}
