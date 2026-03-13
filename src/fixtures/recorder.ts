import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import hash from 'object-hash';
import { writeJsonlGz, readJsonlGz } from './storage.js';
import type { ToolResult } from '../core/types.js';

export interface FixtureEntry {
  tool: string;
  argsHash: string;
  args: Record<string, unknown>;
  result: ToolResult;
  latencyMs: number;
  timestamp: string;
}

export interface FixtureMetadata {
  timestamp: string;
  gitSha?: string;
  clusterVersion?: string;
  [key: string]: unknown;
}

export function hashArgs(args: Record<string, unknown>): string {
  return hash(args, { algorithm: 'sha256', unorderedObjects: true });
}

export class McpFixtureRecorder {
  private buffer: Map<string, FixtureEntry[]> = new Map();
  private readonly fixtureDir: string;

  constructor(fixtureDir: string) {
    this.fixtureDir = fixtureDir;
  }

  record(tool: string, args: Record<string, unknown>, result: ToolResult, latencyMs: number): void {
    const entry: FixtureEntry = {
      tool,
      argsHash: hashArgs(args),
      args,
      result,
      latencyMs,
      timestamp: new Date().toISOString(),
    };

    const existing = this.buffer.get(tool);
    if (existing) {
      existing.push(entry);
    } else {
      this.buffer.set(tool, [entry]);
    }
  }

  async flush(): Promise<void> {
    await mkdir(this.fixtureDir, { recursive: true });

    const writes: Promise<void>[] = [];

    for (const [tool, entries] of this.buffer) {
      const filePath = join(this.fixtureDir, `${tool}.jsonl.gz`);

      writes.push(
        (async () => {
          let existing: unknown[] = [];
          try {
            existing = await readJsonlGz(filePath);
          } catch (err: unknown) {
            const isNotFound =
              err instanceof Error &&
              'code' in err &&
              (err as NodeJS.ErrnoException).code === 'ENOENT';
            if (!isNotFound) throw err;
          }
          await writeJsonlGz(filePath, [...existing, ...entries]);
        })(),
      );
    }

    await Promise.all(writes);
    this.buffer.clear();
  }

  async writeMetadata(meta: FixtureMetadata): Promise<void> {
    await mkdir(this.fixtureDir, { recursive: true });
    const filePath = join(this.fixtureDir, 'metadata.json');
    await writeFile(filePath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
  }
}
