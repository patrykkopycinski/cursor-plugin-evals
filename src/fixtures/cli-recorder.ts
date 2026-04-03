/**
 * Fixture recording/replay for CLI-based adapters (cursor-cli, gemini-cli).
 *
 * Records tool call arguments + results during live runs, then replays them
 * in --mock mode for fast, offline CI without a live cluster.
 *
 * Uses gzip-compressed JSONL (same format as McpFixtureRecorder) with
 * content-hash-based matching and staleness detection.
 */

import { join } from 'node:path';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import hash from 'object-hash';
import { readJsonlGz, writeJsonlGz } from './storage.js';
import type { ToolCallRecord, ToolResult } from '../core/types.js';

export interface CliFixtureEntry {
  tool: string;
  argsHash: string;
  args: Record<string, unknown>;
  result: ToolResult;
  latencyMs: number;
  timestamp: string;
}

export interface CliFixtureMetadata {
  recordedAt: string;
  adapter: string;
  model?: string;
  gitSha?: string;
  clusterVersion?: string;
  entryCount: number;
  toolNames: string[];
  [key: string]: unknown;
}

export function hashToolArgs(args: Record<string, unknown>): string {
  return hash(args, { algorithm: 'sha256', unorderedObjects: true });
}

export class CliFixtureRecorder {
  private buffer: CliFixtureEntry[] = [];
  private readonly fixtureDir: string;
  private readonly adapter: string;

  constructor(fixtureDir: string, adapter: string) {
    this.fixtureDir = fixtureDir;
    this.adapter = adapter;
  }

  record(toolCall: ToolCallRecord): void {
    this.buffer.push({
      tool: toolCall.tool,
      argsHash: hashToolArgs(toolCall.args),
      args: toolCall.args,
      result: toolCall.result ?? { content: [{ type: 'text', text: '' }], isError: false },
      latencyMs: toolCall.latencyMs,
      timestamp: new Date().toISOString(),
    });
  }

  recordAll(toolCalls: ToolCallRecord[]): void {
    for (const tc of toolCalls) this.record(tc);
  }

  async flush(meta?: Partial<CliFixtureMetadata>): Promise<string> {
    await mkdir(this.fixtureDir, { recursive: true });

    const filePath = join(this.fixtureDir, 'fixture.jsonl.gz');

    let existing: CliFixtureEntry[] = [];
    try {
      existing = (await readJsonlGz(filePath)) as CliFixtureEntry[];
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
      if (!isNotFound) throw err;
    }

    const merged = deduplicateEntries([...existing, ...this.buffer]);
    await writeJsonlGz(filePath, merged);

    const toolNames = [...new Set(merged.map((e) => e.tool))];
    const metadata: CliFixtureMetadata = {
      recordedAt: new Date().toISOString(),
      adapter: this.adapter,
      entryCount: merged.length,
      toolNames,
      ...meta,
    };
    await writeFile(join(this.fixtureDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf-8');

    const count = this.buffer.length;
    this.buffer = [];
    return `Recorded ${count} entries (${merged.length} total) to ${filePath}`;
  }
}

function deduplicateEntries(entries: CliFixtureEntry[]): CliFixtureEntry[] {
  const seen = new Map<string, CliFixtureEntry>();
  for (const entry of entries) {
    const key = `${entry.tool}:${entry.argsHash}`;
    seen.set(key, entry);
  }
  return [...seen.values()];
}

export interface CliFixtureResponderOptions {
  maxAgeDays?: number;
  allowFuzzy?: boolean;
}

export class CliFixtureResponder {
  private entries: CliFixtureEntry[] = [];
  private metadata: CliFixtureMetadata | null = null;
  private readonly fixtureDir: string;
  private readonly options: CliFixtureResponderOptions;
  private hits = 0;
  private misses = 0;
  private fuzzyHits = 0;

  constructor(fixtureDir: string, options: CliFixtureResponderOptions = {}) {
    this.fixtureDir = fixtureDir;
    this.options = options;
  }

  async load(): Promise<void> {
    this.entries = [];
    this.metadata = null;

    const filePath = join(this.fixtureDir, 'fixture.jsonl.gz');
    try {
      this.entries = (await readJsonlGz(filePath)) as CliFixtureEntry[];
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
      if (isNotFound) return;
      throw err;
    }

    try {
      const metaRaw = await readFile(join(this.fixtureDir, 'metadata.json'), 'utf-8');
      this.metadata = JSON.parse(metaRaw) as CliFixtureMetadata;
    } catch (_e) {
      // metadata is optional
    }

    if (this.options.maxAgeDays != null) {
      await this.checkFreshness();
    }
  }

  private async checkFreshness(): Promise<void> {
    const filePath = join(this.fixtureDir, 'fixture.jsonl.gz');
    try {
      const fileStat = await stat(filePath);
      const ageDays = (Date.now() - fileStat.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageDays > (this.options.maxAgeDays ?? Infinity)) {
        console.warn(
          `⚠ CLI fixture is ${ageDays.toFixed(1)} days old (max: ${this.options.maxAgeDays}). ` +
            `Re-record with --record to ensure freshness.`,
        );
      }
    } catch (_e) {
      // stat failed — no file
    }
  }

  respond(tool: string, args: Record<string, unknown>): CliFixtureEntry | null {
    const argsH = hashToolArgs(args);

    const exact = this.entries.find((e) => e.tool === tool && e.argsHash === argsH);
    if (exact) {
      this.hits++;
      return exact;
    }

    if (this.options.allowFuzzy !== false) {
      const fuzzy = this.findClosest(tool, args);
      if (fuzzy) {
        this.fuzzyHits++;
        return fuzzy;
      }
    }

    this.misses++;
    return null;
  }

  private findClosest(tool: string, args: Record<string, unknown>): CliFixtureEntry | null {
    const candidates = this.entries.filter((e) => e.tool === tool);
    if (candidates.length === 0) return null;

    let best: CliFixtureEntry | null = null;
    let bestScore = 0;
    const argKeys = Object.keys(args);

    for (const entry of candidates) {
      let score = 0;
      for (const key of argKeys) {
        if (key in entry.args && JSON.stringify(entry.args[key]) === JSON.stringify(args[key])) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }

    const minOverlap = Math.max(1, Math.floor(argKeys.length * 0.5));
    return bestScore >= minOverlap ? best : null;
  }

  get stats(): { hits: number; fuzzyHits: number; misses: number; total: number } {
    return {
      hits: this.hits,
      fuzzyHits: this.fuzzyHits,
      misses: this.misses,
      total: this.entries.length,
    };
  }

  get fixtureMetadata(): CliFixtureMetadata | null {
    return this.metadata;
  }

  get loaded(): boolean {
    return this.entries.length > 0;
  }
}

/**
 * Build a synthetic TaskOutput from recorded fixture entries.
 * Used in mock mode to skip the actual CLI invocation.
 */
export function buildMockOutput(
  entries: CliFixtureEntry[],
  adapter: string,
): {
  toolCalls: ToolCallRecord[];
  output: string;
  latencyMs: number;
} {
  const toolCalls: ToolCallRecord[] = entries.map((e) => ({
    tool: e.tool,
    args: e.args,
    result: e.result,
    latencyMs: e.latencyMs,
  }));

  const lastTextResult = [...entries]
    .reverse()
    .find((e) => !e.result.isError && e.result.content.some((c) => (c.text ?? '').length > 0));

  const output = lastTextResult
    ? lastTextResult.result.content.map((c) => c.text ?? '').join('')
    : `[mock-${adapter}] Replayed ${entries.length} tool call(s) from fixtures`;

  const latencyMs = entries.reduce((sum, e) => sum + e.latencyMs, 0);

  return { toolCalls, output, latencyMs };
}
