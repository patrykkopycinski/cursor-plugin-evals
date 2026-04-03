import type { PluginConfig, McpToolDefinition, TaskAdapter, Example } from '../core/types.js';
import type { AttackCategory, AttackResult } from './types.js';
import { ALL_ATTACK_MODULES } from './attacks/index.js';
import { log } from '../cli/logger.js';
import { evaluateResponse, buildReport, CATEGORY_SEVERITY } from './evaluator.js';

export type { RedTeamReport } from './types.js';

export interface RedTeamConfig {
  plugin: PluginConfig;
  categories?: AttackCategory[];
  countPerCategory?: number;
  model?: string;
  maxTurns?: number;
  timeout?: number;
  /** When provided, use this adapter instead of MCP+agent-loop. */
  adapter?: TaskAdapter;
  /** Tool names for prompt generation (required when using adapter mode). */
  toolNames?: string[];
}

export async function runRedTeam(config: RedTeamConfig): Promise<import('./types.js').RedTeamReport> {
  const countPerCategory = config.countPerCategory ?? 5;
  const model = config.model ?? 'gpt-5.2-mini';
  const maxTurns = config.maxTurns ?? 3;
  const timeout = config.timeout ?? 30_000;
  const selectedCategories = config.categories ?? ALL_ATTACK_MODULES.map((m) => m.category);

  const modules = ALL_ATTACK_MODULES.filter((m) => selectedCategories.includes(m.category));

  log.header('Red Team Scan');
  log.info(`  Categories: ${modules.map((m) => m.category).join(', ')}`);
  log.info(`  Prompts per category: ${countPerCategory}`);
  log.info(`  Model: ${model}`);
  log.info('');

  if (config.adapter) {
    return runWithAdapter(config.adapter, modules, countPerCategory, config.toolNames ?? []);
  }

  return runWithMcp(config, modules, countPerCategory, model, maxTurns, timeout);
}

async function runWithAdapter(
  adapter: TaskAdapter,
  modules: Array<{ category: AttackCategory; generatePrompts: (names: string[], count: number) => string[] }>,
  countPerCategory: number,
  toolNames: string[],
): Promise<import('./types.js').RedTeamReport> {
  const results: AttackResult[] = [];

  for (const mod of modules) {
    const prompts = mod.generatePrompts(toolNames, countPerCategory);
    log.info(`  Running ${mod.category} attacks (${prompts.length} prompts)...`);

    for (const prompt of prompts) {
      try {
        const example: Example = { input: { prompt } };
        const output = await adapter(example);

        const toolsCalled = output.toolCalls.map((tc) => tc.tool);
        results.push(evaluateResponse(mod.category, prompt, output.output, toolsCalled));
      } catch (err) {
        results.push({
          category: mod.category,
          prompt,
          response: `[ERROR] ${err instanceof Error ? err.message : String(err)}`,
          toolsCalled: [],
          severity: CATEGORY_SEVERITY[mod.category],
          passed: true,
          explanation: 'Attack errored out — agent did not comply.',
        });
      }
    }
  }

  return buildReport(results);
}

async function runWithMcp(
  config: RedTeamConfig,
  modules: Array<{ category: AttackCategory; generatePrompts: (names: string[], count: number) => string[] }>,
  countPerCategory: number,
  model: string,
  maxTurns: number,
  timeout: number,
): Promise<import('./types.js').RedTeamReport> {
  // Dynamic imports — MCP runner is only loaded when actually needed
  const { McpPluginClient } = await import('../mcp/client.js');
  const { runAgentLoop } = await import('../layers/llm/agent-loop.js');
  const { buildSystemPrompt } = await import('../layers/llm/system-prompt.js');
  const { parseEntry } = await import('../core/utils.js');

  const { command: cmd, args: cmdArgs } = parseEntry(config.plugin.entry ?? 'node dist/index.js');

  const mcpClient = await McpPluginClient.connect({
    command: cmd,
    args: cmdArgs,
    cwd: config.plugin.dir,
    env: config.plugin.env,
    buildCommand: config.plugin.buildCommand,
  });

  let tools: McpToolDefinition[];
  try {
    tools = await mcpClient.listTools();
  } catch (_e) {
    await mcpClient.disconnect();
    throw new Error('Failed to discover tools from plugin');
  }

  const toolNames = tools.map((t) => t.name);
  const systemPrompt = buildSystemPrompt(config.plugin.name, tools);
  const results: AttackResult[] = [];

  try {
    for (const mod of modules) {
      const prompts = mod.generatePrompts(toolNames, countPerCategory);
      log.info(`  Running ${mod.category} attacks (${prompts.length} prompts)...`);

      for (const prompt of prompts) {
        try {
          const loopResult = await runAgentLoop({
            model,
            systemPrompt,
            userPrompt: prompt,
            tools,
            mcpClient,
            maxTurns,
            timeout,
          });

          const toolsCalled = loopResult.toolCalls.map((tc) => tc.tool);
          results.push(evaluateResponse(mod.category, prompt, loopResult.finalOutput, toolsCalled));
        } catch (err) {
          results.push({
            category: mod.category,
            prompt,
            response: `[ERROR] ${err instanceof Error ? err.message : String(err)}`,
            toolsCalled: [],
            severity: CATEGORY_SEVERITY[mod.category],
            passed: true,
            explanation: 'Attack errored out — agent did not comply.',
          });
        }
      }
    }
  } finally {
    await mcpClient.disconnect();
  }

  return buildReport(results);
}
