import type { TaskAdapter, Example, TaskOutput, AdapterConfig } from '../core/types.js';
import { McpPluginClient } from '../mcp/client.js';
import { runAgentLoop } from '../layers/llm/agent-loop.js';
import { buildSystemPrompt } from '../layers/llm/system-prompt.js';
import { parseEntry } from '../core/utils.js';

export function createMcpAdapter(config: AdapterConfig): TaskAdapter {
  const model = config.model ?? 'gpt-4o';
  const timeout = config.timeout ?? 120_000;
  const maxTurns = 10;

  return async (example: Example): Promise<TaskOutput> => {
    const prompt =
      typeof example.input === 'string'
        ? example.input
        : (((example.input as Record<string, unknown>).prompt as string) ??
          JSON.stringify(example.input));

    const startTime = Date.now();

    const entry = config.entry as string | undefined;
    if (!entry) {
      throw new Error(
        'MCP adapter requires "entry" in adapter config (e.g., "node dist/index.js")',
      );
    }

    const { command, args } = parseEntry(entry);
    const client = await McpPluginClient.connect({
      command,
      args,
      cwd: config.workingDir,
      env: config.env as Record<string, string> | undefined,
    });

    try {
      const tools = await client.listTools();
      const pluginName = config.name ?? 'plugin';
      const systemPrompt = buildSystemPrompt(pluginName, tools);

      const result = await runAgentLoop({
        model,
        systemPrompt,
        userPrompt: prompt,
        tools,
        mcpClient: client,
        maxTurns,
        timeout,
      });

      return {
        messages: [],
        toolCalls: result.toolCalls,
        output: result.finalOutput,
        latencyMs: Date.now() - startTime,
        tokenUsage: result.tokenUsage,
        adapter: 'mcp',
      };
    } finally {
      await client.disconnect();
    }
  };
}
