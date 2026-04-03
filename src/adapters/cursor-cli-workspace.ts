/**
 * Cursor-specific workspace isolation.
 *
 * Wraps the generic `workspace-isolation` module with Cursor plugin
 * conventions: `.cursor-plugin/plugin.json` manifests, Cursor-specific
 * shared symlinks, and `resolveSkillWithDeps` for transitive deps.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, relative, dirname } from 'node:path';
import { resolveSkillWithDeps } from './cursor-cli-skills.js';
import {
  createGenericWorkspace,
  findProjectRoot,
  type WorkspaceIsolationConfig,
} from './workspace-isolation.js';

// Re-export generic types and utilities so existing imports keep working
export type { IsolatedWorkspace } from './workspace-isolation.js';
export {
  EVAL_INFRA_BLOCKLIST,
  copyDirFiltered,
  createSimpleWorkspaceCopy,
} from './workspace-isolation.js';

export interface CreateWorkspaceOptions {
  targetSkillDir: string;
  sourceRoot: string;
  /** Additional skill copy targets beyond the default symlinks. */
  extraSkillCopyTargets?: WorkspaceIsolationConfig['extraSkillCopyTargets'];
  /** Called after workspace creation to write adapter-specific files (e.g., .cursorignore, .gemini/). */
  postSetup?: WorkspaceIsolationConfig['postSetup'];
}

const CURSOR_SHARED_SYMLINKS = [
  '.cursor',
  '.cursor-plugin/marketplace.json',
  'mcp.json',
  'packages',
  'dist',
  'node_modules',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  '.npmrc',
  '.nvmrc',
  'AGENTS.md',
  'CLAUDE.md',
] as const;

/**
 * Create an isolated workspace that mirrors the original repo but only
 * exposes the target skill and its transitive dependencies.
 *
 * Supports adapter hooks for additional skill copy targets and post-setup
 * customization (e.g., Cursor writes `.cursorignore`, Gemini copies into `.gemini/skills/`).
 */
export async function createIsolatedWorkspace(
  targetSkillDirOrOptions: string | CreateWorkspaceOptions,
  sourceRoot?: string,
) {
  let targetSkillDir: string;
  let root: string;
  let extraSkillCopyTargets: CreateWorkspaceOptions['extraSkillCopyTargets'];
  let postSetup: CreateWorkspaceOptions['postSetup'];

  if (typeof targetSkillDirOrOptions === 'string') {
    targetSkillDir = targetSkillDirOrOptions;
    root = sourceRoot!;
  } else {
    targetSkillDir = targetSkillDirOrOptions.targetSkillDir;
    root = targetSkillDirOrOptions.sourceRoot;
    extraSkillCopyTargets = targetSkillDirOrOptions.extraSkillCopyTargets;
    postSetup = targetSkillDirOrOptions.postSetup;
  }

  return createGenericWorkspace({
    targetSkillDir,
    sourceRoot: root,
    sharedSymlinks: CURSOR_SHARED_SYMLINKS,
    resolveSkillDeps: resolveSkillWithDeps,
    writeManifest: writeFilteredPluginManifest,
    extraSkillCopyTargets,
    postSetup,
  });
}

/**
 * Find the root of a skills repository by walking up from a skill directory
 * until we find a `.cursor-plugin/plugin.json`, `package.json`, or `.git`.
 */
export async function findSkillsRoot(skillDir: string): Promise<string> {
  return findProjectRoot(skillDir, ['.cursor-plugin', '.git']);
}

async function writeFilteredPluginManifest(
  tmpBase: string,
  sourceRoot: string,
  includedSkills: string[],
): Promise<void> {
  const manifestPath = join(sourceRoot, '.cursor-plugin', 'plugin.json');
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
  } catch (_e) {
    manifest = { name: 'eval-isolated', skills: [] };
  }

  const relPaths = includedSkills.map((s) => './' + relative(sourceRoot, s));

  const parentDirs = new Set<string>();
  for (const rel of relPaths) {
    parentDirs.add(dirname(rel));
  }

  const originalSkills = (manifest.skills as Array<string | Record<string, unknown>>) ?? [];

  function getSkillPath(entry: string | Record<string, unknown>): string {
    if (typeof entry === 'string') return entry;
    return (entry.path as string) ?? '';
  }

  const filteredSkills = originalSkills.filter((s) => {
    const normalized = getSkillPath(s).replace(/\/$/, '');
    return relPaths.some((r) => r.startsWith(normalized)) || parentDirs.has(normalized);
  });
  if (filteredSkills.length === 0) {
    for (const p of parentDirs) {
      filteredSkills.push(p + '/');
    }
  }

  manifest.skills = filteredSkills;

  const destManifest = join(tmpBase, '.cursor-plugin', 'plugin.json');
  await mkdir(dirname(destManifest), { recursive: true });
  await writeFile(destManifest, JSON.stringify(manifest, null, 2));
}
