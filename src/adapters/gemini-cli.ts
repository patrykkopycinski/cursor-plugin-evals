import type {
  TaskAdapter,
  Example,
  TaskOutput,
  AdapterConfig,
  ToolCallRecord,
} from '../core/types.js';
import {
  normalizeToolCall,
  buildToolCatalogSection,
  type ScriptToolMapping,
} from '../utils/shell-command.js';
import {
  createIsolatedWorkspace,
  findSkillsRoot,
  copyDirFiltered,
  type IsolatedWorkspace,
} from './cursor-cli-workspace.js';
import { resolve, join } from 'path';

export function createGeminiCliAdapter(config: AdapterConfig): TaskAdapter {
  const timeout = config.timeout ?? 120_000;
  const model = config.model;
  const baseWorkspace = config.workingDir ?? process.cwd();
  const skillDir = config.skillPath as string | undefined;
  const toolCatalog = config.toolCatalog;
  const scriptToTool = config['scriptToTool'] as ScriptToolMapping | undefined;

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

    let isolated: IsolatedWorkspace | null = null;
    let workspace = baseWorkspace;

    if (skillDir) {
      const absSkillDir = resolve(baseWorkspace, skillDir);
      const root = await findSkillsRoot(absSkillDir);
      isolated = await createIsolatedWorkspace({
        targetSkillDir: absSkillDir,
        sourceRoot: root,
        extraSkillCopyTargets: async ({ tmpDir, groupName, skillFolderName, skillDir: sd }) => {
          const geminiSkillDir = join(tmpDir, '.gemini', 'skills', groupName, skillFolderName);
          await copyDirFiltered(sd, geminiSkillDir);
        },
      });
      workspace = isolated.dir;
    }

    let effectivePrompt = prompt;
    if (toolCatalog && Object.keys(toolCatalog).length > 0) {
      const catalogSection = buildToolCatalogSection(toolCatalog);
      effectivePrompt =
        `IMPORTANT: Your working directory for this task is ${workspace}. ` +
        `All commands must be run from this directory.${catalogSection}\n\n${prompt}`;
    }

    const geminiArgs = ['--prompt', effectivePrompt, '--yolo', '--output-format', 'jsonl'];
    if (model) geminiArgs.push('--model', model);

    try {
      return await runGeminiProcess(
        spawn,
        geminiPath,
        geminiArgs,
        workspace,
        config,
        timeout,
        startTime,
        scriptToTool,
      );
    } finally {
      await isolated?.cleanup();
    }
  };
}

type SpawnFn = typeof import('child_process').spawn;

interface GeminiJsonlEvent {
  type?: string;
  role?: string;
  content?: string;
  text?: string;
  name?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  input?: Record<string, unknown>;
  result?: unknown;
  response?: string;
  error?: string;
  message?: string;
  session_id?: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  [key: string]: unknown;
}

function runGeminiProcess(
  spawn: SpawnFn,
  geminiPath: string,
  geminiArgs: string[],
  workspace: string,
  config: AdapterConfig,
  timeout: number,
  startTime: number,
  scriptToTool?: ScriptToolMapping,
): Promise<TaskOutput> {
  return new Promise<TaskOutput>((resolveP, rejectP) => {
    const proc = spawn(geminiPath, geminiArgs, {
      cwd: workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(config.env as Record<string, string> | undefined),
      },
    });

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 5_000);
    }, timeout);

    const messages: Array<{ role: string; content: string }> = [];
    const toolCalls: ToolCallRecord[] = [];
    let output = '';
    let pendingToolCall: { name: string; args: Record<string, unknown> } | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let stderrOutput = '';
    let lineBuffer = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        let event: GeminiJsonlEvent;
        try {
          event = JSON.parse(line) as GeminiJsonlEvent;
        } catch {
          continue;
        }

        switch (event.type) {
          case 'message':
            messages.push({
              role: event.role ?? 'assistant',
              content: event.content ?? event.text ?? '',
            });
            break;

          case 'tool_use': {
            const rawName = (event.name ?? event.tool ?? 'unknown') as string;
            const rawArgs = (event.arguments ?? event.input ?? {}) as Record<string, unknown>;

            let resolvedName = rawName;
            let resolvedArgs = rawArgs;
            if (scriptToTool) {
              const normalized = normalizeToolCall(rawName, rawArgs, { scriptToTool });
              resolvedName = normalized.name;
              resolvedArgs = normalized.arguments;
            }

            pendingToolCall = { name: resolvedName, args: resolvedArgs };
            break;
          }

          case 'tool_result':
            if (pendingToolCall) {
              const resultContent =
                typeof event.result === 'string'
                  ? event.result
                  : ((event.content ?? event.text ?? '') as string);
              toolCalls.push({
                tool: pendingToolCall.name,
                args: pendingToolCall.args,
                result: { content: [{ type: 'text', text: resultContent }], isError: false },
                latencyMs: 0,
              });
              pendingToolCall = null;
            }
            break;

          case 'result':
            output = (event.response ?? event.text ?? '') as string;
            if (event.usage) {
              inputTokens += event.usage.input_tokens ?? 0;
              outputTokens += event.usage.output_tokens ?? 0;
            }
            break;

          case 'error':
            break;

          default:
            if (event.usage) {
              inputTokens += event.usage.input_tokens ?? 0;
              outputTokens += event.usage.output_tokens ?? 0;
            }
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timeoutId);

      if (pendingToolCall) {
        toolCalls.push({
          tool: pendingToolCall.name,
          args: pendingToolCall.args,
          result: { content: [{ type: 'text', text: '' }], isError: false },
          latencyMs: 0,
        });
        pendingToolCall = null;
      }

      if (!output && messages.length > 0) {
        output = messages
          .filter((m) => m.role === 'assistant')
          .map((m) => m.content)
          .join('\n');
      }

      if (code !== 0 && code !== null && !signal && !output) {
        rejectP(
          new Error(`Gemini CLI exited with code ${code}. stderr: ${stderrOutput.slice(0, 500)}`),
        );
        return;
      }

      resolveP({
        messages,
        toolCalls,
        output,
        latencyMs: Date.now() - startTime,
        tokenUsage:
          inputTokens > 0 || outputTokens > 0 ? { input: inputTokens, output: outputTokens } : null,
        adapter: 'gemini-cli',
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      rejectP(err);
    });
  });
}
