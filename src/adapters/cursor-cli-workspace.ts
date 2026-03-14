import { mkdir, symlink, readFile, writeFile, readdir, rm, stat, copyFile, cp } from 'fs/promises';
import { join, relative, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { resolveSkillWithDeps, isDirectory } from './cursor-cli-skills.js';

export interface IsolatedWorkspace {
  dir: string;
  cleanup: () => Promise<void>;
  includedSkills: string[];
  skillDir: string | null;
}

export interface CreateWorkspaceOptions {
  targetSkillDir: string;
  sourceRoot: string;
  /** Additional skill copy targets beyond the default symlinks. */
  extraSkillCopyTargets?: (opts: {
    tmpDir: string;
    groupName: string;
    skillFolderName: string;
    skillDir: string;
  }) => Promise<void>;
  /** Called after workspace creation to write adapter-specific files (e.g., .cursorignore, .gemini/). */
  postSetup?: (tmpDir: string) => Promise<void>;
}

export const EVAL_INFRA_BLOCKLIST = new Set([
  'eval.yaml',
  'eval-defaults.yaml',
  'eval-defaults.yml',
]);

/**
 * Copy a directory recursively, skipping eval infrastructure files.
 */
export async function copyDirFiltered(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (EVAL_INFRA_BLOCKLIST.has(entry.name)) continue;

    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await cp(srcPath, destPath, { recursive: true });
    } else {
      await cp(srcPath, destPath);
    }
  }
}

/**
 * Create an isolated workspace that mirrors the original repo but only
 * exposes the target skill and its transitive dependencies.
 *
 * Supports adapter hooks for additional skill copy targets and post-setup
 * customization (e.g., Cursor writes `.cursorignore`, Gemini copies into `.gemini/skills/`).
 *
 * Layout:
 *   <tmp>/
 *     .cursor-plugin/plugin.json     (rewritten to only list included skills)
 *     skills/.../<included>/         (symlinks to real skill dirs)
 *     .cursor/                       (symlink to original, if exists)
 *     node_modules/                  (symlink to original, if exists)
 *     package.json                   (symlink to original, if exists)
 *     <other root files>             (symlinks for common config files)
 */
export async function createIsolatedWorkspace(
  targetSkillDirOrOptions: string | CreateWorkspaceOptions,
  sourceRoot?: string,
): Promise<IsolatedWorkspace> {
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

  const includedSkills = await resolveSkillWithDeps(targetSkillDir, root);

  const tmpBase = join(tmpdir(), 'cursor-eval-' + randomBytes(6).toString('hex'));
  await mkdir(tmpBase, { recursive: true });

  await symlinkSharedInfra(tmpBase, root);

  const skillFolderName = basename(targetSkillDir);
  const groupDir = dirname(targetSkillDir);
  const groupName = basename(groupDir);
  let resolvedSkillDir: string | null = null;

  for (const skillDir of includedSkills) {
    const relPath = relative(root, skillDir);
    const destPath = join(tmpBase, relPath);
    await mkdir(dirname(destPath), { recursive: true });
    await symlink(skillDir, destPath);

    if (skillDir === targetSkillDir) {
      resolvedSkillDir = destPath;
    }
  }

  const sharedDir = join(groupDir, 'shared');
  try {
    const sharedStat = await stat(sharedDir);
    if (sharedStat.isDirectory()) {
      const sharedDest = join(tmpBase, 'skills', groupName, 'shared');
      await mkdir(dirname(sharedDest), { recursive: true });
      await cp(sharedDir, sharedDest, { recursive: true });
    }
  } catch {
    // no shared dir — skip
  }

  const referencesDir = join(groupDir, 'references');
  try {
    const refStat = await stat(referencesDir);
    if (refStat.isDirectory()) {
      const refDest = join(tmpBase, 'skills', groupName, 'references');
      await mkdir(dirname(refDest), { recursive: true });
      await symlink(referencesDir, refDest);
    }
  } catch {
    // no references dir — skip
  }

  if (extraSkillCopyTargets) {
    await extraSkillCopyTargets({
      tmpDir: tmpBase,
      groupName,
      skillFolderName,
      skillDir: targetSkillDir,
    });
  }

  await writeFilteredPluginManifest(tmpBase, root, includedSkills);

  const envSource = join(root, '.env');
  try {
    await stat(envSource);
    await copyFile(envSource, join(tmpBase, '.env'));
  } catch {
    // no .env — skip
  }

  if (postSetup) {
    await postSetup(tmpBase);
  }

  return {
    dir: tmpBase,
    skillDir: resolvedSkillDir,
    includedSkills,
    cleanup: async () => {
      try {
        await rm(tmpBase, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

const SHARED_SYMLINKS = [
  '.cursor',
  '.cursor-plugin/marketplace.json',
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
 * Create a lightweight workspace by symlinking the entire plugin root's content.
 * Used when the eval data directory is outside the plugin root and the full
 * createIsolatedWorkspace logic doesn't apply.
 */
export async function createSimpleWorkspaceCopy(root: string): Promise<IsolatedWorkspace> {
  const tmpBase = join(tmpdir(), 'cursor-eval-' + randomBytes(6).toString('hex'));
  await mkdir(tmpBase, { recursive: true });

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const src = join(root, entry.name);
    const dest = join(tmpBase, entry.name);
    await mkdir(dirname(dest), { recursive: true });
    await symlink(src, dest);
  }

  return {
    dir: tmpBase,
    includedSkills: [],
    skillDir: null,
    cleanup: async () => {
      try {
        await rm(tmpBase, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

async function symlinkSharedInfra(tmpBase: string, sourceRoot: string): Promise<void> {
  for (const item of SHARED_SYMLINKS) {
    const src = join(sourceRoot, item);
    const dest = join(tmpBase, item);
    try {
      await stat(src);
      await mkdir(dirname(dest), { recursive: true });
      await symlink(src, dest);
    } catch {
      // item doesn't exist in source — skip
    }
  }
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
  } catch {
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

/**
 * Find the root of a skills repository by walking up from a skill directory
 * until we find a `.cursor-plugin/plugin.json`, `package.json`, or `.git`.
 */
export async function findSkillsRoot(skillDir: string): Promise<string> {
  let current = skillDir;
  const fsRoot = dirname(current) === current ? current : '/';

  while (current !== fsRoot) {
    if (
      (await isDirectory(join(current, '.cursor-plugin'))) ||
      (await isDirectory(join(current, '.git')))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirname(skillDir);
}
