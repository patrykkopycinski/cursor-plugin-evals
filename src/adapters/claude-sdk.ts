import type { TaskAdapter, Example, TaskOutput, AdapterConfig } from '../core/types.js';

interface ClaudeAgent {
  run(prompt: string): Promise<{
    output: string;
    usage?: { input: number; output: number };
  }>;
}

interface ClaudeSdk {
  createAgent(opts: Record<string, unknown>): ClaudeAgent;
}

export function createClaudeSdkAdapter(config: AdapterConfig): TaskAdapter {
  const timeout = config.timeout ?? 120_000;
  const model = config.model;

  return async (example: Example): Promise<TaskOutput> => {
    const prompt =
      typeof example.input === 'string'
        ? example.input
        : (((example.input as Record<string, unknown>).prompt as string) ??
          JSON.stringify(example.input));

    const startTime = Date.now();

    let sdk: ClaudeSdk;
    try {
      // @ts-expect-error optional dependency — guarded by try/catch
      sdk = (await import('@anthropic-ai/claude-code')) as unknown as ClaudeSdk;
    } catch {
      throw new Error(
        'claude-sdk adapter requires @anthropic-ai/claude-code. Install with: npm install @anthropic-ai/claude-code',
      );
    }

    const agent = sdk.createAgent({
      workingDir: config.workingDir ?? process.cwd(),
      skillPath: config.skillPath,
      model,
      timeout,
    });

    const result = await agent.run(prompt);

    return {
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: result.output },
      ],
      toolCalls: [],
      output: result.output,
      latencyMs: Date.now() - startTime,
      tokenUsage: result.usage ? { input: result.usage.input, output: result.usage.output } : null,
      adapter: 'claude-sdk',
    };
  };
}
