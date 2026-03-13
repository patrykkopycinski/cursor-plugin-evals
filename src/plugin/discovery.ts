import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type {
  PluginManifest,
  SkillComponent,
  RuleComponent,
  AgentComponent,
  CommandComponent,
  HookComponent,
  McpServerComponent,
} from '../core/types.js';
import { parseSkillFile, parseRuleFile, parseAgentFile, parseCommandFile } from './frontmatter.js';

const MARKDOWN_EXTS = ['.md', '.mdc', '.markdown'];
const COMMAND_EXTS = [...MARKDOWN_EXTS, '.txt'];

interface RawManifest {
  name: string;
  description?: string;
  version?: string;
  skills?: string | string[];
  rules?: string | string[];
  agents?: string | string[];
  commands?: string | string[];
  hooks?: string;
  mcpServers?: string;
  [key: string]: unknown;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

function resolvePaths(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function listFiles(dir: string, extensions: string[]): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => extensions.some((ext) => f.endsWith(ext)))
    .map((f) => join(dir, f));
}

function listSubdirsWithFile(dir: string, fileName: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((entry) => {
      const entryPath = join(dir, entry);
      return statSync(entryPath).isDirectory() && existsSync(join(entryPath, fileName));
    })
    .map((entry) => join(dir, entry, fileName));
}

function discoverSkills(pluginDir: string, manifestPaths?: string | string[]): SkillComponent[] {
  const skills: SkillComponent[] = [];

  if (manifestPaths) {
    for (const p of resolvePaths(manifestPaths)) {
      const absDir = resolve(pluginDir, p);
      for (const filePath of listSubdirsWithFile(absDir, 'SKILL.md')) {
        skills.push(parseSkillFile(readText(filePath), filePath));
      }
    }
    return skills;
  }

  const defaultDir = join(pluginDir, 'skills');
  if (existsSync(defaultDir) && statSync(defaultDir).isDirectory()) {
    for (const filePath of listSubdirsWithFile(defaultDir, 'SKILL.md')) {
      skills.push(parseSkillFile(readText(filePath), filePath));
    }
    return skills;
  }

  const rootSkill = join(pluginDir, 'SKILL.md');
  if (existsSync(rootSkill)) {
    skills.push(parseSkillFile(readText(rootSkill), rootSkill));
  }

  return skills;
}

function discoverRules(pluginDir: string, manifestPaths?: string | string[]): RuleComponent[] {
  const rules: RuleComponent[] = [];

  if (manifestPaths) {
    for (const p of resolvePaths(manifestPaths)) {
      const absPath = resolve(pluginDir, p);
      if (existsSync(absPath) && statSync(absPath).isDirectory()) {
        for (const filePath of listFiles(absPath, MARKDOWN_EXTS)) {
          rules.push(parseRuleFile(readText(filePath), filePath));
        }
      } else if (existsSync(absPath)) {
        rules.push(parseRuleFile(readText(absPath), absPath));
      }
    }
    return rules;
  }

  const defaultDir = join(pluginDir, 'rules');
  for (const filePath of listFiles(defaultDir, MARKDOWN_EXTS)) {
    rules.push(parseRuleFile(readText(filePath), filePath));
  }
  return rules;
}

function discoverMarkdown<T>(
  pluginDir: string,
  defaultDirName: string,
  manifestPaths: string | string[] | undefined,
  extensions: string[],
  parser: (content: string, path: string) => T,
): T[] {
  const items: T[] = [];

  if (manifestPaths) {
    for (const p of resolvePaths(manifestPaths)) {
      const absPath = resolve(pluginDir, p);
      if (existsSync(absPath) && statSync(absPath).isDirectory()) {
        for (const filePath of listFiles(absPath, extensions)) {
          items.push(parser(readText(filePath), filePath));
        }
      } else if (existsSync(absPath)) {
        items.push(parser(readText(absPath), absPath));
      }
    }
    return items;
  }

  const defaultDir = join(pluginDir, defaultDirName);
  for (const filePath of listFiles(defaultDir, extensions)) {
    items.push(parser(readText(filePath), filePath));
  }
  return items;
}

function discoverHooks(pluginDir: string, manifestHooks?: string): HookComponent[] {
  const hooksPath = manifestHooks
    ? resolve(pluginDir, manifestHooks)
    : join(pluginDir, 'hooks', 'hooks.json');

  if (!existsSync(hooksPath)) return [];

  const raw = readJson(hooksPath) as Record<string, unknown>;
  const hooksObj = (raw.hooks ?? raw) as Record<string, unknown>;

  const components: HookComponent[] = [];
  for (const [event, handlers] of Object.entries(hooksObj)) {
    if (event === 'version') continue;
    if (!Array.isArray(handlers)) continue;

    components.push({
      event,
      handlers: handlers.map((h: Record<string, unknown>) => ({
        command: String(h.command ?? ''),
        ...(h.matcher !== undefined && { matcher: String(h.matcher) }),
        ...(typeof h.async === 'boolean' && { async: h.async }),
      })),
    });
  }
  return components;
}

function discoverMcpServers(pluginDir: string, manifestMcp?: string): McpServerComponent[] {
  const mcpPath = manifestMcp ? resolve(pluginDir, manifestMcp) : join(pluginDir, '.mcp.json');

  if (!existsSync(mcpPath)) return [];

  const raw = readJson(mcpPath) as Record<string, unknown>;
  const serversObj = (raw.mcpServers ?? raw) as Record<string, unknown>;

  const components: McpServerComponent[] = [];
  for (const [name, config] of Object.entries(serversObj)) {
    if (typeof config !== 'object' || config === null) continue;
    const cfg = config as Record<string, unknown>;
    components.push({
      name,
      ...(cfg.type !== undefined && { type: String(cfg.type) }),
      ...(cfg.command !== undefined && { command: String(cfg.command) }),
      ...(Array.isArray(cfg.args) && { args: cfg.args.map(String) }),
      ...(cfg.url !== undefined && { url: String(cfg.url) }),
      ...(typeof cfg.env === 'object' &&
        cfg.env !== null && {
          env: Object.fromEntries(
            Object.entries(cfg.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          ),
        }),
    });
  }
  return components;
}

export function discoverPlugin(pluginDir: string, pluginRoot?: string): PluginManifest {
  const root = pluginRoot ? resolve(pluginDir, pluginRoot) : pluginDir;
  const manifestPath = join(root, '.cursor-plugin', 'plugin.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`Plugin manifest not found: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath) as RawManifest;

  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error('Plugin manifest missing required "name" field');
  }

  return {
    name: manifest.name,
    description: typeof manifest.description === 'string' ? manifest.description : undefined,
    version: typeof manifest.version === 'string' ? manifest.version : undefined,
    dir: root,
    skills: discoverSkills(root, manifest.skills),
    rules: discoverRules(root, manifest.rules),
    agents: discoverMarkdown(root, 'agents', manifest.agents, MARKDOWN_EXTS, parseAgentFile),
    commands: discoverMarkdown(root, 'commands', manifest.commands, COMMAND_EXTS, parseCommandFile),
    hooks: discoverHooks(root, typeof manifest.hooks === 'string' ? manifest.hooks : undefined),
    mcpServers: discoverMcpServers(
      root,
      typeof manifest.mcpServers === 'string' ? manifest.mcpServers : undefined,
    ),
  };
}
