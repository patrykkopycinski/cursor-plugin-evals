import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname, dirname, basename } from 'node:path';
import type { TraceSource, ParsedTrace, TraceSourceConfig } from './types.js';
import { parseTraces } from './parser.js';

export class FileTraceSource implements TraceSource {
  readonly name = 'file';

  private readonly config: TraceSourceConfig;
  /** Cache: traceId → ParsedTrace */
  private readonly cache = new Map<string, ParsedTrace>();
  /** Whether we've loaded all files yet */
  private loaded = false;

  constructor(config: TraceSourceConfig) {
    this.config = config;
  }

  async getTrace(traceId: string): Promise<ParsedTrace | null> {
    await this.ensureLoaded();
    return this.cache.get(traceId) ?? null;
  }

  async listTraces(options?: {
    limit?: number;
    serviceName?: string;
    timeRange?: { from: string; to: string };
  }): Promise<ParsedTrace[]> {
    await this.ensureLoaded();

    let results = Array.from(this.cache.values());

    if (options?.serviceName) {
      results = results.filter((t) => t.serviceName === options.serviceName);
    }

    if (options?.timeRange) {
      const from = new Date(options.timeRange.from).getTime();
      const to = new Date(options.timeRange.to).getTime();
      results = results.filter((t) => t.startTime >= from && t.endTime <= to);
    }

    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const { path: pathPattern, format = 'auto' } = this.config;
    if (!pathPattern) {
      throw new Error('FileTraceSource: config.path is required');
    }

    const filePaths = await resolveGlob(pathPattern);
    if (filePaths.length === 0) {
      console.warn(
        `[FileTraceSource] No files matched pattern "${pathPattern}". No traces loaded.`,
      );
      return;
    }

    for (const filePath of filePaths) {
      let raw: unknown;
      try {
        const content = await readFile(filePath, 'utf-8');
        raw = JSON.parse(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`[FileTraceSource] Trace file not found: ${filePath}`);
        }
        throw new Error(`[FileTraceSource] Failed to parse "${filePath}" as JSON: ${msg}`);
      }

      let traces: ParsedTrace[];
      try {
        traces = parseTraces(raw, format);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`[FileTraceSource] Failed to parse traces in "${filePath}": ${msg}`);
      }

      if (traces.length === 0) {
        console.warn(`[FileTraceSource] No traces found in "${filePath}".`);
      }

      for (const trace of traces) {
        if (this.cache.has(trace.traceId)) {
          console.warn(
            `[FileTraceSource] Duplicate traceId "${trace.traceId}" in "${filePath}" — overwriting previous entry.`,
          );
        }
        this.cache.set(trace.traceId, trace);
      }
    }
  }
}

/**
 * Resolves a path that may be a simple wildcard pattern or a plain file path.
 * Supports `*.json` and `dir/*.json` patterns (Node 20 compatible, no glob dep).
 */
async function resolveGlob(pattern: string): Promise<string[]> {
  // Simple wildcard: dir/*.json or *.json
  if (pattern.includes('*')) {
    const dir = resolve(dirname(pattern));
    const filePattern = basename(pattern);
    // Convert glob-like *.json to regex
    const regex = new RegExp(
      '^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
    );

    try {
      const entries = await readdir(dir);
      return entries
        .filter((entry) => regex.test(entry))
        .map((entry) => resolve(dir, entry))
        .sort();
    } catch (_e) {
      // Directory doesn't exist — return empty
      return [];
    }
  }

  // Plain path — resolve and return
  const ext = extname(pattern);
  if (!ext) {
    // Try appending .json
    return [resolve(`${pattern}.json`), resolve(pattern)];
  }
  return [resolve(pattern)];
}

export function createFileTraceSource(config: TraceSourceConfig): FileTraceSource {
  return new FileTraceSource(config);
}
