import { existsSync, statSync } from 'fs';
import { resolve, isAbsolute, relative } from 'path';
import type {
  TestResult,
  SuiteConfig,
  StaticTestConfig,
  StaticCheck,
  PluginManifest,
} from '../../core/types.js';
import { log } from '../../cli/logger.js';

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

const VALID_HOOK_EVENTS = new Set([
  'beforeTabFileRead',
  'afterTabFileEdit',
  'sessionStart',
  'sessionEnd',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'subagentStart',
  'subagentStop',
  'beforeShellExecution',
  'afterShellExecution',
  'beforeMCPExecution',
  'afterMCPExecution',
  'beforeReadFile',
  'afterFileEdit',
  'beforeSubmitPrompt',
  'preCompact',
  'stop',
  'afterAgentResponse',
  'afterAgentThought',
]);

function makeResult(
  test: StaticTestConfig,
  suite: string,
  pass: boolean,
  latencyMs: number,
  error?: string,
): TestResult {
  return {
    name: test.name,
    suite,
    layer: 'static',
    pass,
    toolCalls: [],
    evaluatorResults: [],
    latencyMs,
    error,
  };
}

function checkManifest(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];

  if (!manifest.name) {
    errors.push('Manifest missing required "name" field');
  } else if (!KEBAB_RE.test(manifest.name)) {
    errors.push(`Manifest name "${manifest.name}" is not valid kebab-case`);
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function checkSkillFrontmatter(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];
  const skills = filterComponents(manifest.skills, test.components);

  for (const skill of skills) {
    if (!skill.name) errors.push(`Skill at ${skill.path}: missing "name" in frontmatter`);
    if (!skill.description)
      errors.push(`Skill "${skill.name || skill.path}": missing "description"`);
    else if (skill.description.length < 20) {
      errors.push(
        `Skill "${skill.name}": description too short (${skill.description.length} chars, min 20)`,
      );
    }
    if (!skill.body || skill.body.trim().length === 0) {
      errors.push(`Skill "${skill.name || skill.path}": body is empty`);
    }
  }

  if (skills.length === 0 && !test.components) {
    return makeResult(test, suite, true, performance.now() - start);
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function checkRuleFrontmatter(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];
  const rules = manifest.rules;

  for (const rule of rules) {
    if (!rule.description) errors.push(`Rule at ${rule.path}: missing "description"`);
    if (!rule.body || rule.body.trim().length === 0) {
      errors.push(`Rule at ${rule.path}: body is empty`);
    }
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function checkAgentFrontmatter(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];

  for (const agent of manifest.agents) {
    if (!agent.name) errors.push(`Agent at ${agent.path}: missing "name"`);
    if (!agent.description)
      errors.push(`Agent "${agent.name || agent.path}": missing "description"`);
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function checkCommandFrontmatter(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];

  for (const cmd of manifest.commands) {
    if (!cmd.description) errors.push(`Command at ${cmd.path}: missing "description"`);
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function checkHooksSchema(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];

  for (const hook of manifest.hooks) {
    if (!VALID_HOOK_EVENTS.has(hook.event)) {
      errors.push(`Unknown hook event: "${hook.event}"`);
    }
    for (const handler of hook.handlers) {
      if (!handler.command) {
        errors.push(`Hook "${hook.event}": handler missing "command" field`);
        continue;
      }
      const cmdPath = handler.command.replace(/\$\{[^}]+\}/g, '').trim();
      if (cmdPath.startsWith('./') || cmdPath.startsWith('../')) {
        const absPath = resolve(manifest.dir, cmdPath);
        if (!existsSync(absPath)) {
          errors.push(`Hook "${hook.event}": script not found: ${cmdPath}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function checkMcpConfig(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];

  for (const server of manifest.mcpServers) {
    if (!server.command && !server.url) {
      errors.push(`MCP server "${server.name}": needs either "command" (stdio) or "url" (http)`);
    }
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function extractSkillRefs(allowedTools: string | string[] | undefined): string[] {
  if (!allowedTools) return [];
  const values = Array.isArray(allowedTools) ? allowedTools : [allowedTools];
  const refs: string[] = [];
  for (const val of values) {
    const match = /Skill\(([^)]+)\)/.exec(val);
    if (match) refs.push(match[1]);
  }
  return refs;
}

function checkComponentReferences(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];
  const skillNames = new Set(manifest.skills.map((s) => s.name).filter(Boolean));

  for (const cmd of manifest.commands) {
    const refs = extractSkillRefs(cmd.allowedTools);
    for (const ref of refs) {
      if (!skillNames.has(ref)) {
        errors.push(`Command "${cmd.name || cmd.path}" references non-existent skill: "${ref}"`);
      }
    }
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function checkCrossComponentCoherence(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];
  const seen = new Map<string, string>();

  const namedComponents = [
    ...manifest.skills.map((s) => ({ name: s.name, type: 'skill' })),
    ...manifest.agents.map((a) => ({ name: a.name, type: 'agent' })),
    ...manifest.commands.filter((c) => c.name).map((c) => ({ name: c.name!, type: 'command' })),
  ];

  for (const { name, type } of namedComponents) {
    if (!name) continue;
    const existing = seen.get(name);
    if (existing) {
      errors.push(`Duplicate name "${name}" found in ${existing} and ${type}`);
    } else {
      seen.set(name, type);
    }
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function checkNamingConventions(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];

  const names = [
    ...manifest.skills.map((s) => ({ name: s.name, type: 'skill' })),
    ...manifest.agents.map((a) => ({ name: a.name, type: 'agent' })),
    ...manifest.commands.filter((c) => c.name).map((c) => ({ name: c.name!, type: 'command' })),
  ];

  for (const { name, type } of names) {
    if (!name) continue;
    if (!KEBAB_RE.test(name)) {
      errors.push(`${type} name "${name}" is not kebab-case`);
    }
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function checkSkillContentQuality(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];
  const skills = filterComponents(manifest.skills, test.components);

  for (const skill of skills) {
    const body = skill.body ?? '';
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    const headings = body.match(/^#{1,4}\s+.+$/gm) ?? [];
    const codeBlocks = body.match(/```[\s\S]*?```/g) ?? [];

    if (wordCount < 100) {
      errors.push(`Skill "${skill.name}": body too short (${wordCount} words, min 100)`);
    }
    if (headings.length < 2) {
      errors.push(`Skill "${skill.name}": needs at least 2 markdown headings for structure (found ${headings.length})`);
    }
    if (body.length > 0 && !body.includes('##')) {
      errors.push(`Skill "${skill.name}": missing section structure (no ## headings)`);
    }
    if (codeBlocks.length === 0 && wordCount > 200) {
      errors.push(`Skill "${skill.name}": large skill body with no code examples`);
    }
  }

  if (skills.length === 0 && !test.components) {
    return makeResult(test, suite, true, performance.now() - start);
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function checkSkillReferenceFiles(
  test: StaticTestConfig,
  suite: string,
  manifest: PluginManifest,
): TestResult {
  const start = performance.now();
  const errors: string[] = [];
  const skills = filterComponents(manifest.skills, test.components);

  const FILE_REF_PATTERNS = [
    /(?:read|open|load|check|review|reference|see|at)\s+[`"]?([a-zA-Z0-9_/-]+\.[a-z]{1,5})[`"]?/gi,
    /\[([^\]]+)\]\(([^)]+\.[a-z]{1,5})\)/g,
  ];

  for (const skill of skills) {
    const body = skill.body ?? '';
    const referencedFiles = new Set<string>();

    for (const pattern of FILE_REF_PATTERNS) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      while ((match = regex.exec(body)) !== null) {
        const filePath = match[2] ?? match[1];
        if (filePath && !filePath.startsWith('http') && !filePath.includes('*')) {
          referencedFiles.add(filePath);
        }
      }
    }

    const skillDir = resolve(manifest.dir, skill.path, '..');
    for (const ref of referencedFiles) {
      const refPath = isAbsolute(ref) ? ref : resolve(skillDir, ref);
      if (!existsSync(refPath)) {
        const relPath = relative(manifest.dir, refPath);
        errors.push(`Skill "${skill.name}": references "${ref}" but file not found at ${relPath}`);
      }
    }
  }

  if (skills.length === 0 && !test.components) {
    return makeResult(test, suite, true, performance.now() - start);
  }

  if (errors.length > 0) {
    return makeResult(test, suite, false, performance.now() - start, errors.join('; '));
  }
  return makeResult(test, suite, true, performance.now() - start);
}

function filterComponents<T extends { name?: string }>(components: T[], filter?: string[]): T[] {
  if (!filter || filter.length === 0) return components;
  const filterSet = new Set(filter);
  return components.filter((c) => c.name && filterSet.has(c.name));
}

const CHECK_HANDLERS: Record<
  StaticCheck,
  (test: StaticTestConfig, suite: string, manifest: PluginManifest) => TestResult
> = {
  manifest: checkManifest,
  skill_frontmatter: checkSkillFrontmatter,
  rule_frontmatter: checkRuleFrontmatter,
  agent_frontmatter: checkAgentFrontmatter,
  command_frontmatter: checkCommandFrontmatter,
  hooks_schema: checkHooksSchema,
  mcp_config: checkMcpConfig,
  component_references: checkComponentReferences,
  cross_component_coherence: checkCrossComponentCoherence,
  naming_conventions: checkNamingConventions,
  skill_content_quality: checkSkillContentQuality,
  skill_reference_files: checkSkillReferenceFiles,
};

export async function runStaticSuite(
  suite: SuiteConfig,
  manifest: PluginManifest,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const test of suite.tests) {
    const staticTest = test as StaticTestConfig;
    const handler = CHECK_HANDLERS[staticTest.check];

    if (!handler) {
      results.push(
        makeResult(staticTest, suite.name, false, 0, `Unknown check type: "${staticTest.check}"`),
      );
      continue;
    }

    log.test(staticTest.name, 'running');
    const result = handler(staticTest, suite.name, manifest);
    log.test(staticTest.name, result.pass ? 'pass' : 'fail');

    if (!result.pass && result.error) {
      log.debug(result.error);
    }

    results.push(result);
  }

  return results;
}
