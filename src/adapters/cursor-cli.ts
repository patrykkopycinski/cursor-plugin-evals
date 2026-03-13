import type {
  TaskAdapter,
  Example,
  TaskOutput,
  AdapterConfig,
  ToolCallRecord,
  ToolResult,
} from '../core/types.js';
import { resolve, join, dirname } from 'path';
import {
  createIsolatedWorkspace,
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
    if (toolCall[key]) return CURSOR_TOOL_NAMES[key] ?? key.replace('ToolCall', '');
  }
  const fn = toolCall.function as { name?: string } | undefined;
  if (fn?.name) return fn.name;
  return 'unknown';
}

function extractToolArgs(toolCall: Record<string, unknown>): Record<string, unknown> {
  for (const key of TOOL_CALL_KEYS) {
    const call = toolCall[key] as { args?: Record<string, unknown> } | undefined;
    if (call?.args) return call.args;
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

let cursorMutex: Promise<void> = Promise.resolve();

function withCursorLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = cursorMutex;
  let releaseLock: () => void;
  cursorMutex = new Promise<void>((r) => {
    releaseLock = r;
  });
  return prev.then(fn).finally(() => releaseLock!());
}

// --- Cursor agent binary discovery ---

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
  return CURSOR_MODEL_ALIASES[model] ?? model;
}

function resolveCursorAgentCli(): string {
  const fs = require('fs') as typeof import('fs');

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
        return wrapperPath;
      }
    }
  } catch {
    // no local versions found — continue
  }

  try {
    const { createRequire } = require('module') as typeof import('module');
    const req = createRequire(import.meta.url);
    const sdkPkg = req.resolve('@nothumanwork/cursor-agents-sdk/package.json');
    const sdkRoot = dirname(sdkPkg);
    const manifestPath = join(sdkRoot, 'vendor', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const binaryPath = join(sdkRoot, manifest.path);
    if (fs.existsSync(binaryPath)) return binaryPath;
  } catch {
    // SDK not installed — continue
  }

  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    return execSync('which agent', { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error(
      'cursor-cli adapter requires the Cursor Agent CLI. ' +
        'Install: curl https://cursor.com/install -fsS | bash, ' +
        'or npm install @nothumanwork/cursor-agents-sdk',
    );
  }
}

// --- Main adapter ---

export function createCursorCliAdapter(config: AdapterConfig): TaskAdapter {
  const timeout = config.timeout ?? 300_000;
  const model = normalizeCursorModel(config.model);
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

    return withCursorLock(async () => {
      const startTime = Date.now();
      const agentPath = resolveCursorAgentCli();
      const { spawn } = await import('child_process');

      let isolated: IsolatedWorkspace | null = null;
      let workspace = baseWorkspace;

      if (skillDir) {
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
      if (model) agentArgs.push('--model', model);
      agentArgs.push(effectivePrompt);

      try {
        return await runAgent(
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
        await isolated?.cleanup();
      }
    });
  };
}

type SpawnFn = typeof import('child_process').spawn;

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
