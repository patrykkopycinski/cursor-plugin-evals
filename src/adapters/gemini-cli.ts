import type { TaskAdapter, Example, TaskOutput, AdapterConfig } from '../core/types.js';

export function createGeminiCliAdapter(config: AdapterConfig): TaskAdapter {
  const timeout = config.timeout ?? 120_000;
  const model = config.model;

  return async (example: Example): Promise<TaskOutput> => {
    const prompt =
      typeof example.input === 'string'
        ? example.input
        : (((example.input as Record<string, unknown>).prompt as string) ??
          JSON.stringify(example.input));

    const startTime = Date.now();

    let geminiPath: string;
    try {
      const { execSync } = await import('child_process');
      geminiPath = execSync('which gemini', { encoding: 'utf-8' }).trim();
    } catch {
      throw new Error(
        'gemini-cli adapter requires the Gemini CLI. Install from: https://github.com/google-gemini/gemini-cli',
      );
    }

    const { spawn } = await import('child_process');

    const geminiArgs = ['--jsonl'];
    if (model) geminiArgs.push('--model', model);

    return new Promise<TaskOutput>((resolve, reject) => {
      const proc = spawn(geminiPath, geminiArgs, {
        cwd: config.workingDir ?? process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout,
      });

      let output = '';
      const messages: Array<{ role: string; content: string }> = [];
      let totalInput = 0;
      let totalOutput = 0;

      proc.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            if (event.type === 'response' || event.role === 'assistant') {
              const text = (event.content ?? event.text ?? '') as string;
              output = text;
              messages.push({ role: 'assistant', content: text });
            }
            const usage = event.usage as
              | { input_tokens?: number; output_tokens?: number }
              | undefined;
            if (usage) {
              totalInput += usage.input_tokens ?? 0;
              totalOutput += usage.output_tokens ?? 0;
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      });

      proc.on('close', () => {
        resolve({
          messages,
          toolCalls: [],
          output,
          latencyMs: Date.now() - startTime,
          tokenUsage: { input: totalInput, output: totalOutput },
          adapter: 'gemini-cli',
        });
      });

      proc.on('error', (err) => reject(err));

      proc.stdin.write(prompt + '\n');
      proc.stdin.end();
    });
  };
}
