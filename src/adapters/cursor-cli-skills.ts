import { readFile, readdir, stat } from 'fs/promises';
import { join, dirname, basename, relative } from 'node:path';

export interface SkillMeta {
  name: string;
  dir: string;
  dependencies: string[];
}

/**
 * Scan a directory tree for SKILL.md files and parse each one to extract
 * the skill name (from YAML frontmatter) and dependencies (from references
 * to sibling skill paths in the content).
 */
export async function discoverSkillMetas(rootDir: string): Promise<Map<string, SkillMeta>> {
  const skills = new Map<string, SkillMeta>();
  const skillFiles = await findSkillFiles(rootDir);

  for (const skillFile of skillFiles) {
    const content = await readFile(skillFile, 'utf-8');
    const dir = dirname(skillFile);
    const name = parseFrontmatterName(content) ?? basename(dir);
    skills.set(dir, { name, dir, dependencies: [] });
  }

  const allDirs = [...skills.keys()];
  for (const [dir, meta] of skills) {
    const content = await readFile(join(dir, 'SKILL.md'), 'utf-8');
    meta.dependencies = detectDependencies(content, dir, allDirs);
  }

  return skills;
}

/**
 * Given a target skill directory, resolve the full set of directories
 * that need to be available: the skill itself plus all transitive deps.
 */
export async function resolveSkillWithDeps(
  targetSkillDir: string,
  rootDir: string,
): Promise<string[]> {
  const allSkills = await discoverSkillMetas(rootDir);
  const resolved = new Set<string>();
  const queue = [targetSkillDir];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (resolved.has(current)) continue;

    const meta = allSkills.get(current);
    if (!meta) {
      resolved.add(current);
      continue;
    }

    resolved.add(current);
    for (const dep of meta.dependencies) {
      if (!resolved.has(dep)) queue.push(dep);
    }
  }

  return [...resolved];
}

async function findSkillFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (_e) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') continue;

    if (entry.isDirectory()) {
      results.push(...(await findSkillFiles(fullPath)));
    } else if (entry.name === 'SKILL.md') {
      results.push(fullPath);
    }
  }

  return results;
}

function parseFrontmatterName(content: string): string | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  if (!nameMatch) return null;

  return nameMatch[1].trim().replace(/^["']|["']$/g, '');
}

/**
 * Detect dependencies by finding references to sibling skill directories.
 *
 * Matches patterns like:
 *   - "depends on the `case-management` skill"
 *   - "node skills/security/case-management/scripts/..."
 *   - "Use the `alert-triage` skill"
 *   - "use the `detection-rule-management` skill"
 */
function detectDependencies(content: string, selfDir: string, allDirs: string[]): string[] {
  const deps = new Set<string>();

  for (const candidateDir of allDirs) {
    if (candidateDir === selfDir) continue;

    const candidateName = basename(candidateDir);
    const relPath = relative(dirname(selfDir), candidateDir);

    const patterns = [
      new RegExp(`\\b${escapeRegex(candidateName)}\\b.*\\bskill\\b`, 'i'),
      new RegExp(`\\bskill\\b.*\\b${escapeRegex(candidateName)}\\b`, 'i'),
      new RegExp(escapeRegex(relPath.replace(/\\/g, '/'))),
    ];

    for (const pattern of patterns) {
      if (pattern.test(content)) {
        deps.add(candidateDir);
        break;
      }
    }
  }

  return [...deps];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a path exists and is a directory.
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (_e) {
    return false;
  }
}
