import type {
  TaskAdapter,
  Example,
  TaskOutput,
  AdapterConfig,
  ToolCallRecord,
  ToolResult,
} from '../core/types.js';
import { resolve } from 'path';
import { execSync } from 'child_process';
import {
  createIsolatedWorkspace,
  findSkillsRoot,
  type IsolatedWorkspace,
} from './cursor-cli-workspace.js';

/**
 * Resolve the system-installed Claude Code CLI path.
 *
 * The Agent SDK normally resolves cli.js relative to its own import.meta.url,
 * but when the SDK is bundled (as in cursor-plugin-evals dist), that path
 * doesn't exist. We explicitly resolve the `claude` executable from PATH
 * and pass it as `pathToClaudeCodeExecutable` to avoid this.
 */
let _claudeExePath: string | undefined;
function resolveClaudeExecutable(): string {
  if (_claudeExePath) return _claudeExePath;
  try {
    _claudeExePath = execSync('which claude', { encoding: 'utf-8' }).trim();
  } catch {
    _claudeExePath = 'claude'; // fall back to PATH lookup at spawn time
  }
  return _claudeExePath;
}

/**
 * Types from `@anthropic-ai/claude-agent-sdk` — referenced dynamically to keep
 * the dependency optional.  We only import the type-level shapes we need.
 */

interface PendingToolCall {
  tool: string;
  args: Record<string, unknown>;
  startTime: number;
}

/** Map Claude Code built-in tool names to the eval framework's standard names. */
const TOOL_NAME_MAP: Record<string, string> = {
  Bash: 'shell',
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'edit_file',
  Glob: 'glob',
  Grep: 'grep',
  LS: 'list_dir',
  NotebookEdit: 'notebook_edit',
  NotebookRead: 'notebook_read',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  Agent: 'agent',
  TodoWrite: 'todo_write',
};

function normalizeToolName(raw: string): string {
  return TOOL_NAME_MAP[raw] ?? raw;
}

/**
 * Pass model IDs through as-is — the Agent SDK and underlying auth provider
 * (e.g. LLM Gateway) may require the full prefixed model name.
 */
function normalizeModel(model?: string): string | undefined {
  return model || undefined;
}

function extractFilesModified(toolCalls: ToolCallRecord[]): string[] {
  const files = new Set<string>();
  for (const tc of toolCalls) {
    if (
      (tc.tool === 'write_file' || tc.tool === 'edit_file') &&
      typeof tc.args.file_path === 'string'
    ) {
      files.add(tc.args.file_path);
    }
  }
  return [...files];
}

// --- Concurrency serialization (mirrors cursor-cli pattern) ---
let sdkMutex: Promise<void> = Promise.resolve();
let serializeSdk = true;

export function setClaudeSdkConcurrency(parallel: boolean): void {
  serializeSdk = !parallel;
}

function withSdkLock<T>(fn: () => Promise<T>): Promise<T> {
  if (!serializeSdk) return fn();
  const prev = sdkMutex;
  let releaseLock: () => void;
  sdkMutex = new Promise<void>((r) => {
    releaseLock = r;
  });
  return prev.then(fn).finally(() => releaseLock!());
}

// --- Workspace pool type (reused from cursor-cli) ---
// The skill layer imports WorkspacePool and createWorkspacePool from cursor-cli.ts.
// This adapter accepts a WorkspacePool via config, same pattern as cursor-cli.
export interface WorkspacePool {
  acquire(): Promise<IsolatedWorkspace>;
  release(ws: IsolatedWorkspace): void;
  cleanup(): Promise<void>;
}

// --- Main adapter ---

export function createClaudeSdkAdapter(config: AdapterConfig): TaskAdapter {
  const timeout = config.timeout ?? 300_000;
  const model = normalizeModel(config.model);
  const baseWorkspace = config.workingDir ?? process.cwd();
  const skillDir = config.skillPath as string | undefined;
  const skillContent = config['skillContent'] as string | undefined;
  const wsPool = config['workspacePool'] as WorkspacePool | undefined;
  const maxBudget = (config['maxBudgetUsd'] as number | undefined) ?? 1.0;

  return async (example: Example): Promise<TaskOutput> => {
    const rawPrompt =
      typeof example.input === 'string'
        ? example.input
        : (((example.input as Record<string, unknown>).prompt as string) ??
          JSON.stringify(example.input));

    return withSdkLock(async () => {
      const startTime = Date.now();

      // Dynamic import — guarded so the adapter only fails when actually used
      let query: (params: {
        prompt: string;
        options?: Record<string, unknown>;
      }) => AsyncGenerator<Record<string, unknown>, void>;

      try {
        const sdk = await import('@anthropic-ai/claude-agent-sdk');
        query = sdk.query;
      } catch {
        throw new Error(
          'claude-sdk adapter requires @anthropic-ai/claude-agent-sdk. ' +
            'Install with: npm install @anthropic-ai/claude-agent-sdk',
        );
      }

      // --- Workspace isolation ---
      let pooledWs: IsolatedWorkspace | null = null;
      let isolated: IsolatedWorkspace | null = null;
      let workspace = baseWorkspace;

      if (wsPool) {
        pooledWs = await wsPool.acquire();
        workspace = pooledWs.dir;
      } else if (skillDir) {
        const absSkillDir = resolve(baseWorkspace, skillDir);
        const root = await findSkillsRoot(absSkillDir);
        isolated = await createIsolatedWorkspace(absSkillDir, root);
        workspace = isolated.dir;
      }

      // --- Build prompt with optional skill context ---
      const prompt = skillContent
        ? `You have the following skill activated. Follow the skill instructions precisely.\n\n${skillContent}\n\n---\n\nUser request: ${rawPrompt}`
        : rawPrompt;

      // --- Tool call tracking via PostToolUse hooks ---
      const toolCalls: ToolCallRecord[] = [];
      const pendingCalls = new Map<string, PendingToolCall>();

      const hookCallbacks = {
        PreToolUse: [
          {
            hooks: [
              async (
                input: Record<string, unknown>,
                toolUseId: string | undefined,
              ) => {
                const toolName = input.tool_name as string;
                const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
                if (toolUseId) {
                  pendingCalls.set(toolUseId, {
                    tool: normalizeToolName(toolName),
                    args: toolInput,
                    startTime: Date.now(),
                  });
                }
                return { outputToClient: undefined };
              },
            ],
          },
        ],
        PostToolUse: [
          {
            hooks: [
              async (
                input: Record<string, unknown>,
                toolUseId: string | undefined,
              ) => {
                const toolName = normalizeToolName(input.tool_name as string);
                const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
                const toolResponse = input.tool_response;
                const pending = toolUseId ? pendingCalls.get(toolUseId) : undefined;
                const latencyMs = pending ? Date.now() - pending.startTime : 0;

                const resultText =
                  typeof toolResponse === 'string'
                    ? toolResponse
                    : JSON.stringify(toolResponse ?? '');
                const result: ToolResult = {
                  content: [{ type: 'text', text: resultText.slice(0, 2000) }],
                  isError: false,
                };

                toolCalls.push({
                  tool: pending?.tool ?? toolName,
                  args: pending?.args ?? toolInput,
                  result,
                  latencyMs,
                });

                if (toolUseId) pendingCalls.delete(toolUseId);
                return { outputToClient: undefined };
              },
            ],
          },
        ],
        PostToolUseFailure: [
          {
            hooks: [
              async (
                input: Record<string, unknown>,
                toolUseId: string | undefined,
              ) => {
                const toolName = normalizeToolName(input.tool_name as string);
                const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
                const errorMsg = (input.error as string) ?? 'unknown error';
                const pending = toolUseId ? pendingCalls.get(toolUseId) : undefined;
                const latencyMs = pending ? Date.now() - pending.startTime : 0;

                toolCalls.push({
                  tool: pending?.tool ?? toolName,
                  args: pending?.args ?? toolInput,
                  result: {
                    content: [{ type: 'text', text: errorMsg }],
                    isError: true,
                  },
                  latencyMs,
                });

                if (toolUseId) pendingCalls.delete(toolUseId);
                return { outputToClient: undefined };
              },
            ],
          },
        ],
      };

      // --- Build query options ---
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        ...(config.env as Record<string, string> | undefined),
      };

      const options: Record<string, unknown> = {
        cwd: workspace,
        pathToClaudeCodeExecutable: resolveClaudeExecutable(),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxBudgetUsd: maxBudget,
        persistSession: false,
        hooks: hookCallbacks,
        env,
      };

      if (model) {
        options.model = model;
      }

      // Pre-approve all built-in tools so the agent can work autonomously
      options.allowedTools = [
        'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'LS', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent',
      ];

      // --- Abort controller for timeout ---
      const abortController = new AbortController();
      options.abortController = abortController;

      // Suppress unhandled rejection from SDK internal abort handling.
      // The SDK may throw "Operation aborted" asynchronously after we abort,
      // crashing the process if unhandled. We catch it here so the eval run
      // can continue with remaining tests.
      const suppressAbortError = (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('aborted') || msg.includes('Operation aborted')) return;
        throw err; // Re-throw non-abort errors
      };
      process.on('unhandledRejection', suppressAbortError);

      const timer = setTimeout(() => {
        abortController.abort();
      }, timeout);

      // --- Run the query and collect messages ---
      const messages: Array<{ role: string; content: string }> = [];
      let finalOutput = '';
      let durationMs = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedTokens = 0;

      try {
        for await (const message of query({ prompt, options })) {
          const type = message.type as string;

          if (type === 'assistant') {
            const assistantMsg = message as {
              type: 'assistant';
              message: {
                content: Array<{ type: string; text?: string }>;
                usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
              };
            };

            // Collect text content from the assistant message
            const textParts = assistantMsg.message.content
              .filter((b) => b.type === 'text' && b.text)
              .map((b) => b.text!);

            if (textParts.length > 0) {
              messages.push({ role: 'assistant', content: textParts.join('') });
            }

            // Accumulate token usage from each assistant turn
            if (assistantMsg.message.usage) {
              inputTokens += assistantMsg.message.usage.input_tokens ?? 0;
              outputTokens += assistantMsg.message.usage.output_tokens ?? 0;
              cachedTokens += assistantMsg.message.usage.cache_read_input_tokens ?? 0;
            }
          } else if (type === 'user') {
            const userMsg = message as {
              type: 'user';
              message: { role: string; content: unknown };
              isSynthetic?: boolean;
            };
            // Only include real user messages (not synthetic tool results)
            if (!userMsg.isSynthetic) {
              const content =
                typeof userMsg.message.content === 'string'
                  ? userMsg.message.content
                  : JSON.stringify(userMsg.message.content);
              messages.push({ role: 'user', content });
            }
          } else if (type === 'result') {
            const resultMsg = message as {
              type: 'result';
              subtype: string;
              result?: string;
              errors?: string[];
              duration_ms: number;
              usage: {
                input_tokens: number;
                output_tokens: number;
                cache_read_input_tokens?: number;
              };
            };

            finalOutput = resultMsg.result ?? '';
            durationMs = resultMsg.duration_ms ?? 0;

            // Use the cumulative usage from result (overrides per-turn accumulation)
            inputTokens = resultMsg.usage.input_tokens ?? 0;
            outputTokens = resultMsg.usage.output_tokens ?? 0;
            cachedTokens = resultMsg.usage.cache_read_input_tokens ?? 0;

            // Handle error results
            if (resultMsg.subtype !== 'success' && resultMsg.errors?.length) {
              const errText = resultMsg.errors.join('; ');
              if (!finalOutput) {
                finalOutput = `Error: ${errText}`;
              }
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (abortController.signal.aborted) {
          throw new Error(`Claude SDK timed out after ${timeout}ms`);
        }
        throw new Error(`Claude SDK error: ${msg}`);
      } finally {
        clearTimeout(timer);
        process.removeListener('unhandledRejection', suppressAbortError);
        if (pooledWs) {
          wsPool!.release(pooledWs);
        }
        await isolated?.cleanup();
      }

      // Fall back to last assistant message if result didn't include output
      if (!finalOutput) {
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
        finalOutput = lastAssistant?.content ?? '';
      }

      const filesModified = extractFilesModified(toolCalls);

      return {
        messages,
        toolCalls,
        output: finalOutput,
        latencyMs: durationMs || Date.now() - startTime,
        tokenUsage:
          inputTokens > 0 || outputTokens > 0
            ? {
                input: inputTokens + cachedTokens,
                output: outputTokens,
                cached: cachedTokens > 0 ? cachedTokens : undefined,
              }
            : null,
        adapter: 'claude-sdk',
        ...(filesModified.length > 0 ? { filesModified } : {}),
      };
    });
  };
}
