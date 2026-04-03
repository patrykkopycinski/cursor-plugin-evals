import { parse as parseYaml } from 'yaml';
import type {
  SkillComponent,
  RuleComponent,
  AgentComponent,
  CommandComponent,
} from '../core/types.js';

export interface FrontmatterResult {
  attributes: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { attributes: {}, body: content };
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { attributes: {}, body: content };
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  if (yamlBlock.length === 0) {
    return { attributes: {}, body };
  }

  try {
    const attributes = parseYaml(yamlBlock);
    if (typeof attributes !== 'object' || attributes === null || Array.isArray(attributes)) {
      return { attributes: {}, body };
    }
    return { attributes: attributes as Record<string, unknown>, body };
  } catch (_e) {
    // YAML parsing can fail on glob patterns containing * (alias syntax in YAML).
    // Fall back to line-by-line key: value extraction for simple frontmatter.
    const attrs: Record<string, unknown> = {};
    for (const line of yamlBlock.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key && value) {
          if (value === 'true') attrs[key] = true;
          else if (value === 'false') attrs[key] = false;
          else attrs[key] = value;
        }
      }
    }
    return { attributes: attrs, body };
  }
}

function str(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

function bool(val: unknown): boolean | undefined {
  return typeof val === 'boolean' ? val : undefined;
}

function strOrArray(val: unknown): string | string[] | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && val.every((v) => typeof v === 'string')) return val as string[];
  return undefined;
}

export function parseSkillFile(content: string, filePath: string): SkillComponent {
  const { attributes, body } = parseFrontmatter(content);
  return {
    name: str(attributes.name),
    description: str(attributes.description),
    path: filePath,
    body,
    ...(attributes.license !== undefined && { license: str(attributes.license) }),
  };
}

export function parseRuleFile(content: string, filePath: string): RuleComponent {
  const { attributes, body } = parseFrontmatter(content);
  return {
    description: str(attributes.description),
    path: filePath,
    body,
    ...(bool(attributes.alwaysApply) !== undefined && {
      alwaysApply: bool(attributes.alwaysApply),
    }),
    ...(strOrArray(attributes.globs) !== undefined && { globs: strOrArray(attributes.globs) }),
  };
}

export function parseAgentFile(content: string, filePath: string): AgentComponent {
  const { attributes, body } = parseFrontmatter(content);
  return {
    name: str(attributes.name),
    description: str(attributes.description),
    path: filePath,
    body,
    ...(attributes.model !== undefined && { model: str(attributes.model) }),
    ...(bool(attributes.is_background) !== undefined && {
      isBackground: bool(attributes.is_background),
    }),
    ...(bool(attributes.readonly) !== undefined && { readonly: bool(attributes.readonly) }),
  };
}

export function parseCommandFile(content: string, filePath: string): CommandComponent {
  const { attributes, body } = parseFrontmatter(content);
  return {
    description: str(attributes.description),
    path: filePath,
    body,
    ...(attributes.name !== undefined && { name: str(attributes.name) }),
    ...(attributes['argument-hint'] !== undefined && {
      argumentHint: str(attributes['argument-hint']),
    }),
    ...(attributes['allowed-tools'] !== undefined && {
      allowedTools: strOrArray(attributes['allowed-tools']),
    }),
    ...(bool(attributes['disable-model-invocation']) !== undefined && {
      disableModelInvocation: bool(attributes['disable-model-invocation']),
    }),
  };
}
