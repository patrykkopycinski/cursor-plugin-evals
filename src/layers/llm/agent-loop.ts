import type { McpToolDefinition, ToolCallRecord, TokenUsage } from '../../core/types.js';
import type { McpPluginClient } from '../../mcp/client.js';
import type { GuardrailRule, GuardrailViolation } from '../../guardrails/index.js';
import { checkGuardrails } from '../../guardrails/index.js';
import { LlmClient } from './llm-client.js';
import type { LlmMessage, LlmToolDefinition } from './llm-client.js';
import { log } from '../../cli/logger.js';

export interface AgentLoopConfig {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tools: McpToolDefinition[];
  mcpClient: McpPluginClient;
  maxTurns: number;
  timeout: number;
  priorMessages?: Array<{ role: string; content: string }>;
  guardrails?: GuardrailRule[];
}

export interface AgentLoopResult {
  finalOutput: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: TokenUsage;
  turns: number;
  aborted: boolean;
  guardrailViolations: GuardrailViolation[];
}

function mcpToLlmTools(tools: McpToolDefinition[]): LlmToolDefinition[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export async function runAgentLoop(config: AgentLoopConfig): Promise<AgentLoopResult> {
  const llm = new LlmClient(config.model);
  const llmTools = mcpToLlmTools(config.tools);
  const allToolCalls: ToolCallRecord[] = [];
  const totalUsage: TokenUsage = { input: 0, output: 0 };
  const guardrailViolations: GuardrailViolation[] = [];
  let turns = 0;
  let aborted = false;

  const messages: LlmMessage[] = [
    { role: 'system', content: config.systemPrompt },
    ...(config.priorMessages ?? []).map((m) => ({
      role: m.role as LlmMessage['role'],
      content: m.content,
    })),
    { role: 'user', content: config.userPrompt },
  ];

  const timeoutId = setTimeout(() => {
    aborted = true;
  }, config.timeout);

  try {
    while (turns < config.maxTurns && !aborted) {
      turns++;

      log.debug(`Agent loop turn ${turns}/${config.maxTurns} (model: ${config.model})`);

      let response;
      try {
        response = await llm.converse(messages, llmTools, 'auto');
      } catch (err) {
        if (aborted) break;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('content_filter') || errMsg.includes('content management policy')) {
          clearTimeout(timeoutId);
          return {
            finalOutput: `[CONTENT_FILTER] The request was blocked by the provider's content filter: ${errMsg.slice(0, 300)}`,
            toolCalls: allToolCalls,
            tokenUsage: totalUsage,
            turns,
            aborted: false,
            guardrailViolations,
          };
        }
        throw err;
      }

      totalUsage.input += response.usage.input;
      totalUsage.output += response.usage.output;
      if (response.usage.cached) {
        totalUsage.cached = (totalUsage.cached ?? 0) + response.usage.cached;
      }

      messages.push(response.message);

      if (!response.message.tool_calls || response.message.tool_calls.length === 0) {
        clearTimeout(timeoutId);
        return {
          finalOutput: response.message.content ?? '',
          toolCalls: allToolCalls,
          tokenUsage: totalUsage,
          turns,
          aborted: false,
          guardrailViolations,
        };
      }

      for (const toolCall of response.message.tool_calls) {
        if (aborted) break;

        const toolName = toolCall.function.name;
        let toolArgs: Record<string, unknown>;
        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          toolArgs = {};
        }

        log.debug(`  Tool call: ${toolName}(${JSON.stringify(toolArgs).slice(0, 200)})`);

        if (config.guardrails?.length) {
          const violation = checkGuardrails(config.guardrails, toolName, toolArgs);
          if (violation) {
            guardrailViolations.push(violation);
            if (violation.action === 'warn') {
              log.warn(`Guardrail warning [${violation.rule}]: ${violation.message}`);
            } else if (violation.action === 'log') {
              log.debug(`Guardrail log [${violation.rule}]: ${violation.message}`);
            }
            if (violation.action === 'block') {
              log.warn(`Guardrail blocked [${violation.rule}]: ${violation.message}`);
              allToolCalls.push({
                tool: toolName,
                args: toolArgs,
                result: {
                  content: [{ type: 'text', text: `[BLOCKED] ${violation.message}` }],
                  isError: true,
                },
                latencyMs: 0,
              });
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `[BLOCKED] ${violation.message}`,
              });
              continue;
            }
          }
        }

        const callStart = performance.now();
        let result;
        try {
          result = await config.mcpClient.callTool(toolName, toolArgs);
        } catch (err) {
          result = {
            content: [
              { type: 'text' as const, text: err instanceof Error ? err.message : String(err) },
            ],
            isError: true,
          };
        }

        allToolCalls.push({
          tool: toolName,
          args: toolArgs,
          result,
          latencyMs: performance.now() - callStart,
        });

        const toolResponseText = result.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!)
          .join('\n');

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResponseText || '(empty response)',
        });
      }
    }

    clearTimeout(timeoutId);

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.content);
    return {
      finalOutput: lastAssistant?.content ?? '',
      toolCalls: allToolCalls,
      tokenUsage: totalUsage,
      turns,
      aborted,
      guardrailViolations,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
