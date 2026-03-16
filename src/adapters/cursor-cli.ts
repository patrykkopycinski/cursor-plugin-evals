import type {
  TaskAdapter,
  Example,
  TaskOutput,
  AdapterConfig,
  ToolCallRecord,
  ToolResult,
} from '../core/types.js';
import { resolve, join, dirname } from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { spawn, execSync } from 'child_process';
import {
  createIsolatedWorkspace,
  createSimpleWorkspaceCopy,
  findSkillsRoot,
  type IsolatedWorkspace,
} from './cursor-cli-workspace.js';
import {
  normalizeToolCall,
  buildToolCatalogSection,
  type ScriptToolMapping,
} from '../utils/shell-command.js';

/**
 * NDJSON event types emitted by `agent -p --output-format stream-json`.
 * See https://cursor.com/docs/cli/reference/output-format
 */

interface CursorSystemEvent {
  type: 'system';
  subtype: 'init';
  model: string;
  cwd: string;
  session_id: string;
}

interface CursorUserEvent {
  type: 'user';
  message: { role: 'user'; content: Array<{ type: string; text: string }> };
  session_id: string;
}

interface CursorAssistantEvent {
  type: 'assistant';
  message: { role: 'assistant'; content: Array<{ type: string; text: string }> };
  session_id: string;
}

interface CursorToolCallEvent {
  type: 'tool_call';
  subtype: 'started' | 'completed';
  call_id: string;
  tool_call: Record<string, unknown>;
  session_id: string;
}

interface CursorResultEvent {
  type: 'result';
  subtype: 'success' | 'error';
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  result: string;
  session_id: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

type CursorEvent =
  | CursorSystemEvent
  | CursorUserEvent
  | CursorAssistantEvent
  | CursorToolCallEvent
  | CursorResultEvent;

interface PendingToolCall {
  tool: string;
  args: Record<string, unknown>;
  startTime: number;
}

const TOOL_CALL_KEYS = [
  'readToolCall',
  'writeToolCall',
  'shellToolCall',
  'listToolCall',
  'searchToolCall',
  'grepToolCall',
  'globToolCall',
  'mcpToolCall',
  'editToolCall',
  'deleteToolCall',
  'semSearchToolCall',
  'listDirToolCall',
] as const;

const CURSOR_TOOL_NAMES: Record<string, string> = {
  readToolCall: 'read_file',
  writeToolCall: 'write_file',
  shellToolCall: 'shell',
  listToolCall: 'list_dir',
  searchToolCall: 'semantic_search',
  grepToolCall: 'grep',
  globToolCall: 'glob',
  mcpToolCall: 'mcp',
  editToolCall: 'edit_file',
  deleteToolCall: 'delete_file',
  semSearchToolCall: 'semantic_search',
  listDirToolCall: 'list_dir',
};

function extractToolName(toolCall: Record<string, unknown>): string {
  for (const key of TOOL_CALL_KEYS) {
    if (toolCall[key] != null) {
      if (key === 'mcpToolCall') {
        const mcpCall = toolCall[key] as Record<string, unknown>;
        const args = mcpCall.args as Record<string, unknown> | undefined;
        const toolName =
          (mcpCall.toolName as string) ??
          (args?.toolName as string) ??
          (mcpCall.tool_name as string) ??
          (args?.tool_name as string);
        if (toolName) return toolName;
        return 'mcp:unknown';
      }
      return CURSOR_TOOL_NAMES[key] ?? key.replace('ToolCall', '');
    }
  }
  const fn = toolCall.function as { name?: string } | undefined;
  if (fn?.name) return fn.name;
  return 'unknown';
}

function extractToolArgs(toolCall: Record<string, unknown>): Record<string, unknown> {
  for (const key of TOOL_CALL_KEYS) {
    const call = toolCall[key] as { args?: Record<string, unknown> } | undefined;
    if (call?.args) {
      if (key === 'mcpToolCall') {
        const innerArgs = call.args.arguments as Record<string, unknown> | undefined;
        if (innerArgs) return innerArgs;
        const mcpWrapperKeys = new Set([
          'toolName', 'tool_name', 'serverName', 'server_name',
          'name', 'toolCallId', 'providerIdentifier',
        ]);
        const stripped: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(call.args)) {
          if (!mcpWrapperKeys.has(k)) stripped[k] = v;
        }
        return (stripped.args as Record<string, unknown>) ?? stripped;
      }
      return call.args;
    }
  }
  const fn = toolCall.function as { arguments?: string } | undefined;
  if (fn?.arguments) {
    try {
      return JSON.parse(fn.arguments) as Record<string, unknown>;
    } catch {
      return { raw: fn.arguments };
    }
  }
  return {};
}

function extractToolResult(toolCall: Record<string, unknown>): ToolResult {
  for (const key of TOOL_CALL_KEYS) {
    const call = toolCall[key] as { result?: Record<string, unknown> } | undefined;
    if (!call?.result) continue;

    const result = call.result;
    if (result.success) {
      const success = result.success as Record<string, unknown>;
      const text =
        (success.content as string) ?? (success.output as string) ?? JSON.stringify(success);
      return { content: [{ type: 'text', text }], isError: false };
    }
    if (result.error) {
      const text = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
      return { content: [{ type: 'text', text }], isError: true };
    }
  }
  return { content: [{ type: 'text', text: '' }], isError: false };
}

function extractFilesModified(toolCalls: ToolCallRecord[]): string[] {
  const files = new Set<string>();
  for (const tc of toolCalls) {
    if ((tc.tool === 'write_file' || tc.tool === 'edit_file') && typeof tc.args.path === 'string') {
      files.add(tc.args.path);
    }
  }
  return [...files];
}

// --- Concurrency serialization ---
// Cursor Agent CLI supports concurrent sessions when each runs in its own
// isolated workspace (which the skill layer provides). We only serialize when
// sharing a workspace to avoid file conflicts.

let cursorMutex: Promise<void> = Promise.resolve();
let serializeCursor = true;

export function setCursorConcurrency(parallel: boolean): void {
  serializeCursor = !parallel;
}

function withCursorLock<T>(fn: () => Promise<T>): Promise<T> {
  if (!serializeCursor) return fn();
  const prev = cursorMutex;
  let releaseLock: () => void;
  cursorMutex = new Promise<void>((r) => {
    releaseLock = r;
  });
  return prev.then(fn).finally(() => releaseLock!());
}

// --- Cursor agent binary discovery (cached) ---

let cachedAgentPath: string | undefined;

const CURSOR_MODEL_ALIASES: Record<string, string> = {
  'claude-opus-4-6': 'opus-4.6',
  'claude-opus-4-5': 'opus-4.5',
  'claude-sonnet-4-6': 'sonnet-4.6',
  'claude-sonnet-4-5': 'sonnet-4.5',
  'claude-opus-4-6-thinking': 'opus-4.6-thinking',
  'claude-opus-4-5-thinking': 'opus-4.5-thinking',
  'claude-sonnet-4-6-thinking': 'sonnet-4.6-thinking',
  'claude-sonnet-4-5-thinking': 'sonnet-4.5-thinking',
};

function normalizeCursorModel(model?: string): string | undefined {
  if (!model) return undefined;
  const direct = CURSOR_MODEL_ALIASES[model];
  if (direct) return direct;
  const stripped = model.replace(/-\d{8}$/, '');
  return CURSOR_MODEL_ALIASES[stripped] ?? model;
}

function resolveCursorAgentCli(): string {
  if (cachedAgentPath) return cachedAgentPath;

  const localVersionsDir = join(
    process.env.HOME ?? '',
    '.local',
    'share',
    'cursor-agent',
    'versions',
  );
  try {
    const versions = (fs.readdirSync(localVersionsDir) as string[]).sort().reverse();
    for (const ver of versions) {
      const nodeBin = join(localVersionsDir, ver, 'node');
      const indexJs = join(localVersionsDir, ver, 'index.js');
      if (fs.existsSync(nodeBin) && fs.existsSync(indexJs)) {
        const wrapperPath = join(localVersionsDir, ver, 'cursor-agent-wrapper');
        if (!fs.existsSync(wrapperPath)) {
          fs.writeFileSync(wrapperPath, `#!/bin/sh\nexec "${nodeBin}" "${indexJs}" "$@"\n`, {
            mode: 0o755,
          });
        }
        cachedAgentPath = wrapperPath;
        return wrapperPath;
      }
    }
  } catch {
    // no local versions found — continue
  }

  try {
    const req = createRequire(import.meta.url);
    const sdkPkg = req.resolve('@nothumanwork/cursor-agents-sdk/package.json');
    const sdkRoot = dirname(sdkPkg);
    const manifestPath = join(sdkRoot, 'vendor', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const binaryPath = join(sdkRoot, manifest.path);
    if (fs.existsSync(binaryPath)) {
      cachedAgentPath = binaryPath;
      return binaryPath;
    }
  } catch {
    // SDK not installed — continue
  }

  try {
    const found = execSync('which agent', { encoding: 'utf-8' }).trim();
    cachedAgentPath = found;
    return found;
  } catch {
    throw new Error(
      'cursor-cli adapter requires the Cursor Agent CLI. ' +
        'Install: curl https://cursor.com/install -fsS | bash, ' +
        'or npm install @nothumanwork/cursor-agents-sdk',
    );
  }
}

// --- Workspace pool ---
// Pre-creates N isolated workspaces for a skill dir so concurrent tests don't
// each pay the cost of skill discovery + workspace creation.

export interface WorkspacePool {
  acquire(): Promise<IsolatedWorkspace>;
  release(ws: IsolatedWorkspace): void;
  cleanup(): Promise<void>;
}

export async function createWorkspacePool(
  skillDir: string,
  baseWorkspace: string,
  size: number,
  pluginRoot?: string,
): Promise<WorkspacePool> {
  const absSkillDir = resolve(baseWorkspace, skillDir);
  const root = pluginRoot ?? await findSkillsRoot(absSkillDir);

  const skillInsideRoot = absSkillDir.startsWith(root + '/') || absSkillDir === root;

  const available: IsolatedWorkspace[] = [];
  const all: IsolatedWorkspace[] = [];

  const createOne = async () => {
    let ws: IsolatedWorkspace;
    if (skillInsideRoot) {
      ws = await createIsolatedWorkspace(absSkillDir, root);
    } else {
      ws = await createSimpleWorkspaceCopy(root);
    }
    all.push(ws);
    return ws;
  };

  const initial = await Promise.all(Array.from({ length: size }, () => createOne()));
  available.push(...initial);

  const waiting: Array<(ws: IsolatedWorkspace) => void> = [];

  return {
    acquire(): Promise<IsolatedWorkspace> {
      const ws = available.pop();
      if (ws) return Promise.resolve(ws);
      return new Promise<IsolatedWorkspace>((resolve) => waiting.push(resolve));
    },
    release(ws: IsolatedWorkspace): void {
      const waiter = waiting.shift();
      if (waiter) {
        waiter(ws);
      } else {
        available.push(ws);
      }
    },
    async cleanup(): Promise<void> {
      await Promise.all(all.map((ws) => ws.cleanup()));
    },
  };
}

// --- Main adapter ---

export function createCursorCliAdapter(config: AdapterConfig): TaskAdapter {
  const timeout = config.timeout ?? 300_000;
  const model = normalizeCursorModel(config.model);
  const baseWorkspace = config.workingDir ?? process.cwd();
  const skillDir = config.skillPath as string | undefined;
  const toolCatalog = config.toolCatalog;
  const scriptToTool = config['scriptToTool'] as ScriptToolMapping | undefined;
  const wsPool = config['workspacePool'] as WorkspacePool | undefined;
  const readOnly = config['readOnly'] === true;

  return async (example: Example): Promise<TaskOutput> => {
    const prompt =
      typeof example.input === 'string'
        ? example.input
        : (((example.input as Record<string, unknown>).prompt as string) ??
          JSON.stringify(example.input));

    return withCursorLock(async () => {
      const startTime = Date.now();
      const agentPath = resolveCursorAgentCli();

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

      let effectivePrompt = prompt;
      if (toolCatalog && Object.keys(toolCatalog).length > 0) {
        const catalogSection = buildToolCatalogSection(toolCatalog);
        effectivePrompt =
          `IMPORTANT: Your working directory for this task is ${workspace}. ` +
          `All commands must be run from this directory.${catalogSection}\n\n${prompt}`;
      }

      const agentArgs = [
        '-p',
        '--force',
        '--output-format',
        'stream-json',
        '--approve-mcps',
        '--trust',
        '--workspace',
        workspace,
      ];
      if (readOnly) agentArgs.push('--mode', 'ask');
      if (model) agentArgs.push('--model', model);
      agentArgs.push(effectivePrompt);

      try {
        return await runAgentWithRetry(
          spawn,
          agentPath,
          agentArgs,
          workspace,
          config,
          timeout,
          startTime,
          scriptToTool,
        );
      } finally {
        if (pooledWs) {
          wsPool!.release(pooledWs);
        }
        await isolated?.cleanup();
      }
    });
  };
}

type SpawnFn = typeof spawn;

const CLI_CONFIG_RACE_PATTERN = /cli-config\.json/;
const DEFAULT_MAX_CLI_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 2000;

async function runAgentWithRetry(
  spawnFn: SpawnFn,
  agentPath: string,
  agentArgs: string[],
  workspace: string,
  config: AdapterConfig,
  timeout: number,
  startTime: number,
  scriptToTool?: ScriptToolMapping,
): Promise<TaskOutput> {
  const retryConfig = config.retry;
  const maxRetries = retryConfig?.maxRetries ?? DEFAULT_MAX_CLI_RETRIES;
  const baseDelay = retryConfig?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const retryPattern = retryConfig?.retryPattern
    ? new RegExp(retryConfig.retryPattern)
    : CLI_CONFIG_RACE_PATTERN;

  const originalStartTime = startTime;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const remainingTimeout = Math.max(30_000, timeout - (Date.now() - originalStartTime));
      return await runAgent(spawnFn, agentPath, agentArgs, workspace, config, remainingTimeout, startTime, scriptToTool);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = retryPattern.test(msg);
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = baseDelay * (attempt + 1) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, delay));
      startTime = Date.now();
    }
  }
  throw new Error('unreachable');
}

function runAgent(
  spawn: SpawnFn,
  agentPath: string,
  agentArgs: string[],
  workspace: string,
  config: AdapterConfig,
  timeout: number,
  startTime: number,
  scriptToTool?: ScriptToolMapping,
): Promise<TaskOutput> {
  return new Promise<TaskOutput>((resolveP, rejectP) => {
    const proc = spawn(agentPath, agentArgs, {
      cwd: workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      env: {
        ...process.env,
        ...(config.env as Record<string, string> | undefined),
      },
    });

    const messages: Array<{ role: string; content: string }> = [];
    const toolCalls: ToolCallRecord[] = [];
    const pendingCalls = new Map<string, PendingToolCall>();
    let finalOutput = '';
    let durationMs = 0;
    let stderrOutput = '';
    let lineBuffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    proc.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        let event: CursorEvent;
        try {
          event = JSON.parse(line) as CursorEvent;
        } catch {
          continue;
        }

        switch (event.type) {
          case 'user':
            messages.push({
              role: 'user',
              content: event.message.content.map((c) => c.text).join(''),
            });
            break;

          case 'assistant':
            messages.push({
              role: 'assistant',
              content: event.message.content.map((c) => c.text).join(''),
            });
            break;

          case 'tool_call':
            if (event.subtype === 'started') {
              const rawName = extractToolName(event.tool_call);
              const rawArgs = extractToolArgs(event.tool_call);
              pendingCalls.set(event.call_id, {
                tool: rawName,
                args: rawArgs,
                startTime: Date.now(),
              });
            } else if (event.subtype === 'completed') {
              const pending = pendingCalls.get(event.call_id);
              const latencyMs = pending ? Date.now() - pending.startTime : 0;
              const rawName = pending?.tool ?? extractToolName(event.tool_call);
              const rawArgs = pending?.args ?? extractToolArgs(event.tool_call);

              let resolvedName = rawName;
              let resolvedArgs = rawArgs;
              if (rawName === 'shell' && scriptToTool) {
                const normalized = normalizeToolCall(rawName, rawArgs, { scriptToTool });
                resolvedName = normalized.name;
                resolvedArgs = normalized.arguments;
              }

              toolCalls.push({
                tool: resolvedName,
                args: resolvedArgs,
                result: extractToolResult(event.tool_call),
                latencyMs,
              });
              pendingCalls.delete(event.call_id);
            }
            break;

          case 'result': {
            finalOutput = event.result ?? '';
            durationMs = event.duration_ms ?? 0;
            const usage = (event as CursorResultEvent).usage;
            if (usage) {
              inputTokens += usage.input_tokens ?? 0;
              outputTokens += usage.output_tokens ?? 0;
            }
            break;
          }
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    proc.on('close', (code) => {
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer) as CursorEvent;
          if (event.type === 'result') {
            finalOutput = (event as CursorResultEvent).result ?? finalOutput;
            durationMs = (event as CursorResultEvent).duration_ms ?? durationMs;
            const usage = (event as CursorResultEvent).usage;
            if (usage) {
              inputTokens += usage.input_tokens ?? 0;
              outputTokens += usage.output_tokens ?? 0;
            }
          }
        } catch {
          // incomplete final line — ignore
        }
      }

      if (code !== 0 && !finalOutput) {
        rejectP(
          new Error(`Cursor CLI exited with code ${code}. stderr: ${stderrOutput.slice(0, 500)}`),
        );
        return;
      }

      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      const output = finalOutput || lastAssistant?.content || '';
      const filesModified = extractFilesModified(toolCalls);

      if (inputTokens === 0 && outputTokens === 0) {
        const allText = messages.map((m) => m.content).join('') + output;
        const toolText = toolCalls.map((tc) => JSON.stringify(tc.args)).join('');
        outputTokens = Math.ceil((allText.length + toolText.length) / 4);
      }

      resolveP({
        messages,
        toolCalls,
        output,
        latencyMs: durationMs || Date.now() - startTime,
        tokenUsage:
          inputTokens > 0 || outputTokens > 0 ? { input: inputTokens, output: outputTokens } : null,
        adapter: 'cursor-cli',
        ...(filesModified.length > 0 ? { filesModified } : {}),
      });
    });

    proc.on('error', (err) => rejectP(err));

    proc.stdin.end();
  });
}
