import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { TransportConfig } from './types.js';

function isFlag(arg: string): boolean {
  return arg.startsWith('-');
}

function isSystemCommand(cmd: string): boolean {
  return !cmd.includes('/') && !cmd.includes('\\');
}

export function createStdioTransport(config: TransportConfig): Transport {
  if (!config.command) {
    throw new Error('stdio transport requires a "command" field');
  }

  let mergedEnv: Record<string, string>;
  let command = config.command;
  let args = config.args;
  let cwd = config.cwd;

  if (config.isolateEnv) {
    const systemVars: Record<string, string> = {};
    for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'TMPDIR', 'NODE_PATH', 'NODE_OPTIONS', 'LANG', 'LC_ALL']) {
      if (process.env[key]) systemVars[key] = process.env[key]!;
    }
    mergedEnv = { ...systemVars, ...(config.env ?? {}) };

    const absDir = config.cwd ? resolve(config.cwd) : process.cwd();

    if (!isSystemCommand(command) && !isAbsolute(command)) {
      command = resolve(absDir, command);
    }
    if (args?.length) {
      args = args.map((arg) =>
        isFlag(arg) || isAbsolute(arg) ? arg : resolve(absDir, arg),
      );
    }
    cwd = tmpdir();
  } else {
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) cleanEnv[k] = v;
    }
    mergedEnv = { ...cleanEnv, ...config.env };
  }

  return new StdioClientTransport({
    command,
    args,
    cwd,
    env: mergedEnv,
    stderr: 'pipe',
  });
}
