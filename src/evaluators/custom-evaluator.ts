import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import {
  PROTOCOL_VERSION,
  toCustomEvalInput,
  fromCustomEvalOutput,
  validateCustomEvalOutput,
  type EvaluatorManifest,
} from './custom-protocol.js';

export interface CustomEvaluatorConfig {
  /** Path to evaluator executable or directory with evaluator.json manifest */
  path: string;
  /** Override evaluator name */
  name?: string;
  /** Pass/fail threshold (default: 0.5) */
  threshold?: number;
  /** Timeout in ms (default: 30000) */
  timeout?: number;
  /** Extra config passed to evaluator */
  config?: Record<string, unknown>;
  /** Runtime to use: auto-detect from manifest or file extension */
  runtime?: 'node' | 'python' | 'shell' | 'auto';
}

interface ResolvedEntry {
  cmd: string;
  args: string[];
  resolvedName: string;
  extraConfig: Record<string, unknown>;
}

async function readManifest(dir: string): Promise<EvaluatorManifest | null> {
  const manifestPath = join(dir, 'evaluator.json');
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = await readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as EvaluatorManifest;
  } catch {
    return null;
  }
}

function runtimeFromExtension(filePath: string): ResolvedEntry['cmd'] | null {
  switch (extname(filePath).toLowerCase()) {
    case '.ts':
      return 'tsx';
    case '.js':
    case '.mjs':
      return 'node';
    case '.py':
      return 'python3';
    case '.sh':
      return 'sh';
    case '.go':
      return 'go';
    default:
      return null;
  }
}

function buildCommand(filePath: string, runtime: string): [string, string[]] {
  switch (runtime) {
    case 'tsx':
      return ['npx', ['tsx', filePath]];
    case 'node':
      return ['node', [filePath]];
    case 'python3':
    case 'python':
      return [runtime, [filePath]];
    case 'sh':
      return ['sh', [filePath]];
    case 'go':
      return ['go', ['run', filePath]];
    default:
      return [runtime, [filePath]];
  }
}

async function resolveEntry(config: CustomEvaluatorConfig): Promise<ResolvedEntry> {
  const absPath = resolve(config.path);

  // Check if path is a directory → look for manifest
  if (existsSync(absPath)) {
    const stat = await import('node:fs/promises').then((fs) => fs.stat(absPath));
    if (stat.isDirectory()) {
      const manifest = await readManifest(absPath);
      if (!manifest) {
        throw new Error(`No evaluator.json found in directory: ${absPath}`);
      }
      if (manifest.protocol_version !== PROTOCOL_VERSION) {
        throw new Error(
          `Protocol version mismatch: evaluator uses ${manifest.protocol_version}, framework requires ${PROTOCOL_VERSION}`,
        );
      }
      const entryPath = join(absPath, manifest.entry);
      const detectedRuntime = runtimeFromExtension(entryPath);
      const runtime = detectedRuntime ?? manifest.language;
      const [cmd, args] = buildCommand(entryPath, runtime);
      return {
        cmd,
        args,
        resolvedName: config.name ?? manifest.name,
        extraConfig: {},
      };
    }
  }

  // Single file path
  const userRuntime = config.runtime && config.runtime !== 'auto' ? config.runtime : null;
  let runtime: string;

  if (userRuntime) {
    runtime = userRuntime === 'python' ? 'python3' : userRuntime;
  } else {
    const detected = runtimeFromExtension(absPath);
    if (!detected) {
      throw new Error(
        `Cannot detect runtime for: ${absPath}. Use "runtime" config or a recognized extension (.ts, .js, .mjs, .py, .sh, .go)`,
      );
    }
    runtime = detected;
  }

  const [cmd, args] = buildCommand(absPath, runtime);
  const fallbackName = config.name ?? absPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'custom';

  return {
    cmd,
    args,
    resolvedName: fallbackName,
    extraConfig: {},
  };
}

function runSubprocess(
  cmd: string,
  args: string[],
  stdinData: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Evaluator timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

      if (code !== 0) {
        const detail = stderr ? `: ${stderr}` : '';
        reject(new Error(`Evaluator exited with code ${code}${detail}`));
        return;
      }

      resolve(stdout);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(stdinData, 'utf-8');
    child.stdin.end();
  });
}

function extractJson(stdout: string): unknown {
  // Try parsing the last line first (most evaluators print JSON on the last line)
  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{')) {
      try {
        return JSON.parse(line);
      } catch {
        // Not valid JSON, try next line
      }
    }
  }

  // Fallback: try parsing the entire stdout
  try {
    return JSON.parse(stdout.trim());
  } catch {
    // Fall through to error
  }

  throw new Error(`No JSON object found in evaluator output: ${stdout.trim().slice(0, 200)}`);
}

export class CustomEvaluator implements Evaluator {
  name: string;
  kind: EvaluatorKind = 'CODE';

  private readonly config: CustomEvaluatorConfig;

  constructor(config: CustomEvaluatorConfig) {
    this.config = config;
    this.name = config.name ?? 'custom';
  }

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const threshold = this.config.threshold ?? 0.5;
    const timeoutMs = this.config.timeout ?? 30_000;

    let entry: ResolvedEntry;
    try {
      entry = await resolveEntry(this.config);
    } catch (err) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Failed to resolve evaluator: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Use resolved name going forward
    const evaluatorName = entry.resolvedName;

    // Build context with merged config (evaluator.json extras + user config)
    const mergedContext: EvaluatorContext = {
      ...context,
      config: {
        ...entry.extraConfig,
        ...this.config.config,
        ...context.config,
      },
    };

    const input = toCustomEvalInput(mergedContext, evaluatorName);
    const stdinData = JSON.stringify(input);

    let stdout: string;
    try {
      stdout = await runSubprocess(entry.cmd, entry.args, stdinData, timeoutMs);
    } catch (err) {
      return {
        evaluator: evaluatorName,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Evaluator execution failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    let raw: unknown;
    try {
      raw = extractJson(stdout);
    } catch (err) {
      return {
        evaluator: evaluatorName,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Failed to parse evaluator output: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const { valid, errors, output } = validateCustomEvalOutput(raw);
    if (!valid || !output) {
      return {
        evaluator: evaluatorName,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Invalid evaluator output: ${errors.join('; ')}`,
      };
    }

    return fromCustomEvalOutput(output, evaluatorName, threshold);
  }
}
