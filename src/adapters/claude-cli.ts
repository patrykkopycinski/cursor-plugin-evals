import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import type { TaskAdapter, Example, TaskOutput, AdapterConfig } from '../core/types.js';

/** JSON output from `claude -p --output-format json` */
interface ClaudeJsonResult {
  type: 'result';
  subtype: 'success' | 'error';
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  stop_reason: string;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  };
  modelUsage?: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
    }
  >;
}

/** NDJSON event from `claude -p --output-format stream-json --verbose` */
interface ClaudeStreamEvent {
  type: 'system' | 'assistant' | 'user' | 'tool_use' | 'result';
  subtype?: string;
  session_id?: string;
  message?: { role: string; content: string };
  tool_use?: { name: string; input: Record<string, unknown> };
  tool_result?: { content: string; is_error?: boolean };
  result?: string;
  usage?: ClaudeJsonResult['usage'];
  duration_ms?: number;
  total_cost_usd?: number;
}

function resolveClaudeCli(): string {
  // Check common locations
  const candidates = [
    process.env.CLAUDE_CLI_PATH,
    join(process.env.HOME ?? '', '.local/bin/claude'),
    join(process.env.HOME ?? '', '.claude/bin/claude'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // not found, continue
    }
  }

  // Fall back to PATH lookup
  return 'claude';
}

/** Strip LiteLLM/gateway prefixes and normalize to Claude model IDs */
function normalizeModel(model?: string): string | undefined {
  if (!model) return undefined;
  // Strip llm-gateway/ or similar prefixes
  const stripped = model.replace(/^(llm-gateway|anthropic|litellm)\//i, '');
  // Map common aliases
  const aliases: Record<string, string> = {
    'gpt-4o': undefined as unknown as string, // not a Claude model
    'gpt-4': undefined as unknown as string,
  };
  return aliases[stripped] !== undefined ? aliases[stripped] || undefined : stripped;
}

export function createClaudeCliAdapter(config: AdapterConfig): TaskAdapter {
  const timeout = config.timeout ?? 120_000;
  const model = normalizeModel(config.model);
  const workingDir = config.workingDir ?? process.cwd();
  const skillContent = config['skillContent'] as string | undefined;
  const claudePath = resolveClaudeCli();

  return async (example: Example): Promise<TaskOutput> => {
    const rawPrompt =
      typeof example.input === 'string'
        ? example.input
        : (((example.input as Record<string, unknown>).prompt as string) ??
          JSON.stringify(example.input));

    // Prepend skill content as context if available
    const prompt = skillContent
      ? `You have the following skill activated. Follow the skill instructions precisely.\n\n${skillContent}\n\n---\n\nUser request: ${rawPrompt}`
      : rawPrompt;

    const startTime = Date.now();

    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--no-session-persistence',
    ];

    // Use --bare in CI (ANTHROPIC_API_KEY auth, no hooks/keychain/OAuth)
    if (process.env.CI || process.env.CLAUDE_CLI_BARE) {
      args.push('--bare');
    }

    if (model) {
      args.push('--model', model);
    }

    // Add max budget to prevent runaway costs
    args.push('--max-budget-usd', '1.00');

    const result = await runClaude(claudePath, args, workingDir, timeout, config.env as Record<string, string> | undefined);

    return {
      messages: [
        { role: 'user', content: rawPrompt },
        { role: 'assistant', content: result.result },
      ],
      toolCalls: [],
      output: result.result,
      latencyMs: result.duration_ms,
      tokenUsage: {
        input: result.usage.input_tokens + (result.usage.cache_read_input_tokens ?? 0),
        output: result.usage.output_tokens,
        cached: result.usage.cache_read_input_tokens,
      },
      adapter: 'claude-cli',
    };
  };
}

function runClaude(
  claudePath: string,
  args: string[],
  cwd: string,
  timeout: number,
  env?: Record<string, string>,
): Promise<ClaudeJsonResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Claude CLI timed out after ${timeout}ms`));
    }, timeout);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      // Parse JSON result — claude outputs JSON on first line, may have hook output after.
      // Note: exit code may be non-zero due to SessionEnd hooks failing, but the JSON
      // result is still valid if present.
      const firstLine = stdout.split('\n').find((l) => l.trim().startsWith('{'));

      if (!firstLine) {
        if (code !== 0 && code !== null) {
          reject(
            new Error(
              `Claude CLI exited with code ${code}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`,
            ),
          );
        } else {
          reject(new Error(`Claude CLI produced no JSON output. stderr: ${stderr.slice(0, 500)}`));
        }
        return;
      }

      try {
        const parsed = JSON.parse(firstLine) as ClaudeJsonResult;
        if (parsed.is_error) {
          reject(new Error(`Claude CLI error: ${parsed.result}`));
          return;
        }
        resolve(parsed);
      } catch (e) {
        reject(
          new Error(`Failed to parse Claude CLI JSON: ${(e as Error).message}\nOutput: ${firstLine.slice(0, 300)}`),
        );
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn Claude CLI at ${claudePath}: ${err.message}`));
    });

    // Close stdin immediately — we pass prompt via args
    proc.stdin.end();
  });
}
