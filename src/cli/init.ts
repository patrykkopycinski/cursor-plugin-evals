import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { stringify as yamlStringify } from 'yaml';
import { discoverPlugin } from '../plugin/discovery.js';
import { log } from './logger.js';
import type { PluginManifest, McpServerComponent, StaticCheck } from '../core/types.js';

export interface InitOptions {
  dir: string;
  output: string;
  interactive?: boolean;
  pluginRoot?: string;
  transport?: string;
  layers?: string[];
}

interface ToolInfo {
  name: string;
  description?: string;
}

interface GenerateConfigOptions {
  transport?: string;
  layers?: string[];
}

const ALL_STATIC_CHECKS: StaticCheck[] = [
  'manifest',
  'skill_frontmatter',
  'rule_frontmatter',
  'agent_frontmatter',
  'command_frontmatter',
  'hooks_schema',
  'mcp_config',
  'component_references',
  'cross_component_coherence',
  'naming_conventions',
];

function extractToolsFromMcpServers(servers: McpServerComponent[]): ToolInfo[] {
  return servers.map((s) => ({
    name: s.name,
    description: `MCP server: ${s.name}`,
  }));
}

export function generateConfig(
  manifest: PluginManifest,
  tools: ToolInfo[],
  options: GenerateConfigOptions = {},
): Record<string, unknown> {
  const transport = options.transport ?? 'stdio';
  const layers = new Set(options.layers ?? ['static', 'unit', 'integration', 'llm']);

  const pluginConfig: Record<string, unknown> = {
    name: manifest.name,
    dir: manifest.dir,
    entry: 'node dist/index.js',
  };

  if (transport !== 'stdio') {
    pluginConfig.transport = transport;
    if (transport === 'http' || transport === 'sse' || transport === 'streamable-http') {
      pluginConfig.url = 'http://localhost:3000/mcp';
    }
  }

  const suites: Record<string, unknown>[] = [];

  if (layers.has('static')) {
    suites.push({
      name: 'static-analysis',
      layer: 'static',
      tests: ALL_STATIC_CHECKS.map((check) => ({
        name: check.replace(/_/g, '-'),
        check,
      })),
    });
  }

  if (layers.has('unit')) {
    const toolNames = tools.length > 0 ? tools.map((t) => t.name) : undefined;
    suites.push({
      name: 'unit-registration',
      layer: 'unit',
      tests: [
        {
          name: 'all-tools-register',
          check: 'registration',
          ...(toolNames && { expectedTools: toolNames }),
        },
      ],
    });
  }

  if (layers.has('integration')) {
    const integrationTests =
      tools.length > 0
        ? tools.map((t) => ({
            name: `${t.name}-smoke`,
            tool: t.name,
            args: {},
          }))
        : [{ name: 'sample-tool-call', tool: 'your_tool_name', args: {} }];

    suites.push({
      name: 'integration-smoke',
      layer: 'integration',
      tests: integrationTests,
    });
  }

  if (layers.has('llm')) {
    const llmTests =
      tools.length > 0
        ? tools.map((t) => ({
            name: `select-${t.name}`,
            difficulty: 'simple' as const,
            prompt: `Use the ${t.name} tool${t.description ? ` to ${t.description}` : ''}.`,
            expected: { tools: [t.name] },
            evaluators: ['tool-selection', 'response-quality'],
          }))
        : [
            {
              name: 'basic-prompt',
              difficulty: 'simple' as const,
              prompt: 'What tools are available?',
              expected: { tools: [] },
              evaluators: ['tool-selection', 'response-quality'],
            },
          ];

    suites.push({
      name: 'llm-e2e',
      layer: 'llm',
      tests: llmTests,
    });
  }

  return {
    plugin: pluginConfig,
    defaults: {
      timeout: 30000,
      repetitions: 3,
      judge_model: 'gpt-4o',
      thresholds: {
        'tool-selection': 0.8,
        'tool-args': 0.7,
      },
    },
    suites,
  };
}

export async function initCommand(opts: InitOptions): Promise<void> {
  log.header('Init — Generate plugin-eval.yaml');

  let pluginDir = resolve(process.cwd(), opts.dir);
  let transport = opts.transport ?? 'stdio';
  let selectedLayers = opts.layers ?? ['static', 'unit', 'integration', 'llm'];

  if (opts.interactive) {
    const { input, select, checkbox } = await import('@inquirer/prompts');

    pluginDir = resolve(
      process.cwd(),
      await input({
        message: 'Plugin directory:',
        default: opts.dir,
      }),
    );

    transport = await select({
      message: 'Transport type:',
      choices: [
        { value: 'stdio', name: 'stdio (default)' },
        { value: 'http', name: 'HTTP' },
        { value: 'sse', name: 'SSE' },
        { value: 'streamable-http', name: 'Streamable HTTP' },
      ],
    });

    selectedLayers = await checkbox({
      message: 'Layers to generate:',
      choices: [
        { value: 'static', name: 'Static analysis', checked: true },
        { value: 'unit', name: 'Unit tests', checked: true },
        { value: 'integration', name: 'Integration tests', checked: true },
        { value: 'llm', name: 'LLM evaluation', checked: true },
      ],
    });
  }

  let manifest: PluginManifest;
  try {
    manifest = discoverPlugin(pluginDir, opts.pluginRoot);
    log.success(`Discovered plugin: ${manifest.name}`);
    log.info(`  Skills: ${manifest.skills.length}, Rules: ${manifest.rules.length}, Agents: ${manifest.agents.length}`);
    log.info(`  Commands: ${manifest.commands.length}, MCP Servers: ${manifest.mcpServers.length}`);
  } catch (err) {
    log.error('Failed to discover plugin', err);
    log.warn('Generating config with placeholder values');
    manifest = {
      name: 'my-plugin',
      dir: pluginDir,
      skills: [],
      rules: [],
      agents: [],
      commands: [],
      hooks: [],
      mcpServers: [],
    };
  }

  const tools = extractToolsFromMcpServers(manifest.mcpServers);

  const config = generateConfig(manifest, tools, {
    transport,
    layers: selectedLayers,
  });

  const yamlContent = yamlStringify(config, { lineWidth: 120 });
  const outPath = resolve(process.cwd(), opts.output);
  writeFileSync(outPath, yamlContent, 'utf-8');
  log.success(`Config written to ${outPath}`);
}
