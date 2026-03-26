export interface TraceEntry {
  name: string;
  args: unknown[];
  result?: unknown;
  error?: string;
  startMs: number;
  endMs: number;
  latencyMs: number;
}

export interface TraceSummary {
  totalCalls: number;
  uniqueFunctions: number;
  errors: number;
  totalLatencyMs: number;
  entries: TraceEntry[];
}

export class TraceCollector {
  private entries: TraceEntry[] = [];

  wrap<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    const self = this;
    return async function (this: unknown, ...args: A): Promise<R> {
      const start = performance.now();
      const entry: TraceEntry = { name, args, startMs: start, endMs: 0, latencyMs: 0 };
      self.entries.push(entry);
      try {
        const result = await fn.apply(this, args);
        entry.result = result;
        return result;
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        entry.endMs = performance.now();
        entry.latencyMs = entry.endMs - entry.startMs;
      }
    };
  }

  getEntries(): TraceEntry[] { return [...this.entries]; }

  getSummary(): TraceSummary {
    const names = new Set(this.entries.map(e => e.name));
    return {
      totalCalls: this.entries.length,
      uniqueFunctions: names.size,
      errors: this.entries.filter(e => e.error).length,
      totalLatencyMs: this.entries.reduce((s, e) => s + e.latencyMs, 0),
      entries: this.getEntries(),
    };
  }

  reset(): void { this.entries = []; }
}
