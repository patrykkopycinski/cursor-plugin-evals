import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import hash from 'object-hash';
import { readJsonlGz } from './storage.js';
import type { ToolResult } from '../core/types.js';
import type { FixtureEntry } from './recorder.js';

export interface FixtureMatch {
  result: ToolResult;
  matchType: 'exact' | 'fuzzy' | 'miss';
  latencyMs: number;
}

export class McpFixtureResponder {
  private fixtures: Map<string, FixtureEntry[]> = new Map();
  private readonly fixtureDir: string;

  constructor(fixtureDir: string) {
    this.fixtureDir = fixtureDir;
  }

  async load(): Promise<void> {
    this.fixtures.clear();

    let files: string[];
    try {
      files = await readdir(this.fixtureDir);
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
      if (isNotFound) return;
      throw err;
    }

    const jsonlGzFiles = files.filter((f) => f.endsWith('.jsonl.gz'));

    await Promise.all(
      jsonlGzFiles.map(async (file) => {
        const filePath = join(this.fixtureDir, file);
        const entries = (await readJsonlGz(filePath)) as FixtureEntry[];
        const toolName = file.replace(/\.jsonl\.gz$/, '');
        this.fixtures.set(toolName, entries);
      }),
    );
  }

  respond(tool: string, args: Record<string, unknown>): FixtureMatch | null {
    const entries = this.fixtures.get(tool);
    if (!entries || entries.length === 0) return null;

    const argsHash = hash(args, { algorithm: 'sha256', unorderedObjects: true });

    const exact = entries.find((e) => e.argsHash === argsHash);
    if (exact) {
      return { result: exact.result, matchType: 'exact', latencyMs: exact.latencyMs };
    }

    const fuzzy = this.findClosest(entries, args);
    if (fuzzy) {
      return { result: fuzzy.result, matchType: 'fuzzy', latencyMs: fuzzy.latencyMs };
    }

    return null;
  }

  /**
   * Scores each fixture entry by counting how many top-level arg keys
   * share the same value, then returns the entry with the highest overlap.
   */
  private findClosest(entries: FixtureEntry[], args: Record<string, unknown>): FixtureEntry | null {
    let best: FixtureEntry | null = null;
    let bestScore = -1;

    const argKeys = Object.keys(args);

    for (const entry of entries) {
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

    return bestScore > 0 ? best : null;
  }
}
