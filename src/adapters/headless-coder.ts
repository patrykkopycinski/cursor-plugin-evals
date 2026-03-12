import type { TaskAdapter, Example, TaskOutput, AdapterConfig } from '../core/types.js';

interface HeadlessCoderAgent {
  run(prompt: string): Promise<{
    output: string;
    toolCalls?: unknown[];
    usage?: { input: number; output: number };
  }>;
}

interface HeadlessCoderSdk {
  Agent: new (opts: Record<string, unknown>) => HeadlessCoderAgent;
}

export function createHeadlessCoderAdapter(config: AdapterConfig): TaskAdapter {
  const timeout = config.timeout ?? 120_000;
  const model = config.model;

  return async (example: Example): Promise<TaskOutput> => {
    const prompt =
      typeof example.input === 'string'
        ? example.input
        : (((example.input as Record<string, unknown>).prompt as string) ??
          JSON.stringify(example.input));

    const startTime = Date.now();

    let sdk: HeadlessCoderSdk;
    try {
      // @ts-expect-error optional dependency — guarded by try/catch
      sdk = (await import('@headless-coder-sdk/core')) as unknown as HeadlessCoderSdk;
    } catch {
      throw new Error(
        'headless-coder adapter requires @headless-coder-sdk/core. Install with: npm install @headless-coder-sdk/core',
      );
    }

    const agent = new sdk.Agent({
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
      adapter: 'headless-coder',
    };
  };
}
