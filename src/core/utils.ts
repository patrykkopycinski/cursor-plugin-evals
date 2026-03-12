import type { DefaultsConfig } from './types.js';

export function parseEntry(entry: string): { command: string; args: string[] } {
  if (!entry || entry.trim().length === 0) {
    throw new Error('Plugin entry must be a non-empty string');
  }
  const parts = entry.split(/\s+/);
  return { command: parts[0], args: parts.slice(1) };
}

export function resolveDotPath(obj: unknown, path: string): unknown {
  const segments = path.replace(/\[(\d+)]/g, '.$1').split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isFinite(index)) {
        current = current[index];
        continue;
      }
    }

    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

export function mergeDefaults(
  suiteDefaults?: DefaultsConfig,
  globalDefaults?: DefaultsConfig,
): DefaultsConfig {
  return {
    ...globalDefaults,
    ...suiteDefaults,
    thresholds: {
      ...globalDefaults?.thresholds,
      ...suiteDefaults?.thresholds,
    },
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}
