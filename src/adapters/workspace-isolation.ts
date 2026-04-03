/**
 * Generic workspace isolation utilities.
 *
 * Platform-agnostic: creates temporary, isolated workspaces by symlinking
 * shared infrastructure and copying skill directories. Cursor-specific
 * behaviour (manifest rewriting, `.cursor-plugin` detection) lives in
 * `cursor-cli-workspace.ts` which delegates here.
 */

import { mkdir, symlink, readdir, rm, stat, copyFile, cp } from 'fs/promises';
import { join, relative, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

export interface IsolatedWorkspace {
  dir: string;
  cleanup: () => Promise<void>;
  includedSkills: string[];
  skillDir: string | null;
}

export interface WorkspaceIsolationConfig {
  targetSkillDir: string;
  sourceRoot: string;
  /** Symlink paths relative to sourceRoot to share with the workspace. */
  sharedSymlinks: readonly string[];
  /** Resolve skill dependencies — returns absolute paths of included skill dirs. */
  resolveSkillDeps: (targetDir: string, root: string) => Promise<string[]>;
  /** Write a filtered manifest in the workspace (e.g. plugin.json). */
  writeManifest?: (tmpBase: string, root: string, includedSkills: string[]) => Promise<void>;
  /** Additional skill copy targets beyond the default symlinks. */
  extraSkillCopyTargets?: (opts: {
    tmpDir: string;
    groupName: string;
    skillFolderName: string;
    skillDir: string;
  }) => Promise<void>;
  /** Called after workspace creation to write adapter-specific files. */
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
 * Create a lightweight workspace by symlinking the entire root's content.
 * Used when the eval data directory is outside the project root and the full
 * isolation logic doesn't apply.
 */
export async function createSimpleWorkspaceCopy(root: string): Promise<IsolatedWorkspace> {
  const tmpBase = join(tmpdir(), 'eval-ws-' + randomBytes(6).toString('hex'));
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
      } catch (_e) {
        // best-effort cleanup
      }
    },
  };
}

/**
 * Create an isolated workspace that mirrors the original repo but only
 * exposes the target skill and its transitive dependencies.
 *
 * Platform-specific behaviour is injected via `WorkspaceIsolationConfig`:
 * - `sharedSymlinks` — which top-level items to symlink
 * - `resolveSkillDeps` — how to discover transitive skill deps
 * - `writeManifest` — how to write a filtered project manifest
 */
export async function createGenericWorkspace(
  config: WorkspaceIsolationConfig,
): Promise<IsolatedWorkspace> {
  const {
    targetSkillDir,
    sourceRoot,
    sharedSymlinks,
    resolveSkillDeps,
    writeManifest,
    extraSkillCopyTargets,
    postSetup,
  } = config;

  const includedSkills = await resolveSkillDeps(targetSkillDir, sourceRoot);

  const tmpBase = join(tmpdir(), 'eval-ws-' + randomBytes(6).toString('hex'));
  await mkdir(tmpBase, { recursive: true });

  // Symlink shared infrastructure
  for (const item of sharedSymlinks) {
    const src = join(sourceRoot, item);
    const dest = join(tmpBase, item);
    try {
      await stat(src);
      await mkdir(dirname(dest), { recursive: true });
      await symlink(src, dest);
    } catch (_e) {
      // item doesn't exist in source — skip
    }
  }

  const skillFolderName = basename(targetSkillDir);
  const groupDir = dirname(targetSkillDir);
  const groupName = basename(groupDir);
  let resolvedSkillDir: string | null = null;

  for (const skillDir of includedSkills) {
    const relPath = relative(sourceRoot, skillDir);
    const destPath = join(tmpBase, relPath);
    await mkdir(dirname(destPath), { recursive: true });
    await symlink(skillDir, destPath);

    if (skillDir === targetSkillDir) {
      resolvedSkillDir = destPath;
    }
  }

  // Copy shared/ and references/ sibling dirs if they exist
  const sharedDir = join(groupDir, 'shared');
  try {
    const sharedStat = await stat(sharedDir);
    if (sharedStat.isDirectory()) {
      const sharedDest = join(tmpBase, 'skills', groupName, 'shared');
      await mkdir(dirname(sharedDest), { recursive: true });
      await cp(sharedDir, sharedDest, { recursive: true });
    }
  } catch (_e) {
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
  } catch (_e) {
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

  if (writeManifest) {
    await writeManifest(tmpBase, sourceRoot, includedSkills);
  }

  // Copy .env if present
  const envSource = join(sourceRoot, '.env');
  try {
    await stat(envSource);
    await copyFile(envSource, join(tmpBase, '.env'));
  } catch (_e) {
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
      } catch (_e) {
        // best-effort cleanup
      }
    },
  };
}

/**
 * Find the root of a project by walking up from a directory until we find
 * one of the given marker directories/files (e.g. `.git`, `package.json`).
 */
export async function findProjectRoot(
  startDir: string,
  markers: readonly string[] = ['.git'],
): Promise<string> {
  let current = startDir;
  const fsRoot = dirname(current) === current ? current : '/';

  while (current !== fsRoot) {
    for (const marker of markers) {
      try {
        await stat(join(current, marker));
        return current;
      } catch (_e) {
        // marker not found — continue
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirname(startDir);
}
