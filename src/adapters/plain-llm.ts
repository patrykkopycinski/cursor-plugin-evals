import type {
  TaskAdapter,
  Example,
  TaskOutput,
  AdapterConfig,
  ToolCallRecord,
} from '../core/types.js';

export function createPlainLlmAdapter(config: AdapterConfig): TaskAdapter {
  const model = config.model ?? 'gpt-4o';
  const timeout = config.timeout ?? 120_000;
  const maxTurns = 10;
  const apiBaseUrl = config.apiBaseUrl ?? process.env.LITELLM_URL ?? 'https://api.openai.com/v1';
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';

  return async (example: Example): Promise<TaskOutput> => {
    const prompt =
      typeof example.input === 'string'
        ? example.input
        : (((example.input as Record<string, unknown>).prompt as string) ??
          JSON.stringify(example.input));

    const startTime = Date.now();
    const messages: Array<{ role: string; content: string }> = [{ role: 'user', content: prompt }];
    const toolCalls: ToolCallRecord[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let finalOutput = '';

    for (let turn = 0; turn < maxTurns; turn++) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(`${apiBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: 4096,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new Error(`LLM API error ${response.status}: ${errorBody.slice(0, 500)}`);
        }

        const data = (await response.json()) as {
          choices: Array<{
            message: { role: string; content: string | null; tool_calls?: unknown[] };
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        const choice = data.choices?.[0];
        if (!choice) break;

        totalInput += data.usage?.prompt_tokens ?? 0;
        totalOutput += data.usage?.completion_tokens ?? 0;

        if (choice.message.content) {
          finalOutput = choice.message.content;
          messages.push({ role: 'assistant', content: choice.message.content });
        }

        if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
          break;
        }
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    return {
      messages,
      toolCalls,
      output: finalOutput,
      latencyMs: Date.now() - startTime,
      tokenUsage: { input: totalInput, output: totalOutput },
      adapter: 'plain-llm',
    };
  };
}
