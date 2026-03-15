import type { DefaultsConfig, PluginConfig } from './types.js';
import type { McpConnectConfig } from '../mcp/client.js';

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

/**
 * Returns the list of env var names that are missing or empty.
 * If all are present, returns an empty array.
 */
export function getMissingEnvVars(testRequireEnv?: string[], suiteRequireEnv?: string[]): string[] {
  const required = new Set<string>([...(suiteRequireEnv ?? []), ...(testRequireEnv ?? [])]);
  if (required.size === 0) return [];

  const missing: string[] = [];
  for (const name of required) {
    if (name.includes('|')) {
      const alternatives = name.split('|').map((s) => s.trim());
      if (!alternatives.some((alt) => process.env[alt])) {
        missing.push(name);
      }
    } else if (!process.env[name]) {
      missing.push(name);
    }
  }
  return missing;
}

export function buildConnectConfig(plugin: PluginConfig): McpConnectConfig {
  const config: McpConnectConfig = {
    buildCommand: plugin.buildCommand,
    env: plugin.env,
  };

  if (plugin.transport && plugin.transport !== 'stdio') {
    config.transport = {
      type: plugin.transport,
      url: plugin.url,
      headers: plugin.headers,
    };
  } else if (plugin.entry) {
    const { command, args } = parseEntry(plugin.entry);
    config.command = command;
    config.args = args;
    config.cwd = plugin.dir;
  }

  return config;
}
