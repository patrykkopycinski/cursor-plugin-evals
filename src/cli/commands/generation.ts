import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { log, setLogLevel, setNoColor } from '../logger.js';
import { EXIT_FAIL, EXIT_CONFIG_ERROR, parsePositiveInt } from './helpers.js';

export function registerGenerationCommands(program: Command): void {
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
          const { McpPluginClient } = await import('../../mcp/client.js');
          const { parseEntry } = await import('../../core/utils.js');
          const { generateTestsFromSchema } = await import('../../gen-tests/schema-walker.js');
          const { formatAsYaml } = await import('../../gen-tests/formatter.js');

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
                await import('../../gen-tests/smart-gen.js');
              const smartTests = await generateSmartTests({
                tools: filtered,
                count: 5,
                personas: opts.personas as Array<'novice' | 'expert' | 'adversarial'> | undefined,
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
          const { simulateConversation } = await import('../../conversation-sim/simulator.js');
          const { formatAsConversationYaml } = await import('../../conversation-sim/formatter.js');
          const { McpPluginClient } = await import('../../mcp/client.js');
          const { parseEntry } = await import('../../core/utils.js');

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
                tools: mcpTools,
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

        const { generateMockServer } = await import('../../fixtures/mock-gen.js');
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
}
