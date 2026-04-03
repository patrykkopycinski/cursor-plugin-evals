import { readdir, readFile } from 'fs/promises';
import { join } from 'node:path';
import type { SkillInfo, CollisionPair, CollisionReport } from '../core/types.js';

const ROUTING_ERROR = 0.85;
const ROUTING_WARN = 0.7;

export async function scanSkills(skillsDir: string): Promise<SkillInfo[]> {
  const topEntries = await readdir(skillsDir, { withFileTypes: true });
  const skills: SkillInfo[] = [];

  for (const entry of topEntries) {
    if (!entry.isDirectory()) continue;
    const entryPath = join(skillsDir, entry.name);

    const directSkillMd = join(entryPath, 'SKILL.md');
    try {
      const content = await readFile(directSkillMd, 'utf-8');
      skills.push(parseSkillMd(entry.name, content));
      continue;
    } catch (_e) {
      // Check nested children
    }

    try {
      const children = await readdir(entryPath, { withFileTypes: true });
      for (const child of children) {
        if (!child.isDirectory()) continue;
        const childSkillPath = join(entryPath, child.name, 'SKILL.md');
        try {
          const content = await readFile(childSkillPath, 'utf-8');
          skills.push(parseSkillMd(child.name, content));
        } catch (_e) {
          // No SKILL.md — skip
        }
      }
    } catch (_e) {
      // Can't read directory — skip
    }
  }

  return skills;
}

function parseSkillMd(dirName: string, content: string): SkillInfo {
  const lines = content.split('\n');
  let name = dirName;
  let description = '';
  const tools: string[] = [];
  let inFrontmatter = false;
  let frontmatterDone = false;

  for (const line of lines) {
    if (line.trim() === '---' && !frontmatterDone) {
      if (inFrontmatter) {
        frontmatterDone = true;
      }
      inFrontmatter = !inFrontmatter;
      continue;
    }

    if (inFrontmatter) {
      const nameMatch = line.match(/^name:\s*(.+)/);
      if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');

      const descMatch = line.match(/^description:\s*(.+)/);
      if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
    }

    const toolMatch = line.match(/`(\w+(?:_\w+)*)`/g);
    if (toolMatch) {
      for (const match of toolMatch) {
        const toolName = match.replace(/`/g, '');
        if (toolName.includes('_') && !tools.includes(toolName)) {
          tools.push(toolName);
        }
      }
    }
  }

  return { name, dirName, description, tools, body: content };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function computeTfIdf(docA: string[], docB: string[]): number {
  const allTerms = new Set([...docA, ...docB]);
  const freqA = new Map<string, number>();
  const freqB = new Map<string, number>();

  for (const t of docA) freqA.set(t, (freqA.get(t) ?? 0) + 1);
  for (const t of docB) freqB.set(t, (freqB.get(t) ?? 0) + 1);

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (const term of allTerms) {
    const a = freqA.get(term) ?? 0;
    const b = freqB.get(term) ?? 0;
    dotProduct += a * b;
    magA += a * a;
    magB += b * b;
  }

  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (Math.sqrt(magA) * Math.sqrt(magB));
}

function computeDescriptionSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  return computeTfIdf(tokensA, tokensB);
}

function computeToolOverlap(
  toolsA: string[],
  toolsB: string[],
): { overlap: number; shared: string[] } {
  const setA = new Set(toolsA);
  const setB = new Set(toolsB);
  const shared = toolsA.filter((t) => setB.has(t));
  const union = new Set([...toolsA, ...toolsB]);
  const overlap = union.size > 0 ? shared.length / union.size : 0;
  return { overlap, shared };
}

function classifyVerdict(descSim: number, toolOverlap: number): 'ok' | 'warn' | 'error' {
  const combined = descSim * 0.6 + toolOverlap * 0.4;
  if (combined >= ROUTING_ERROR) return 'error';
  if (combined >= ROUTING_WARN) return 'warn';
  return 'ok';
}

export async function analyzeCollisions(skillsDir: string): Promise<CollisionReport> {
  const skills = await scanSkills(skillsDir);
  const pairs: CollisionPair[] = [];

  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const a = skills[i];
      const b = skills[j];

      const descriptionSimilarity = computeDescriptionSimilarity(a.description, b.description);
      const { overlap: toolOverlap, shared: sharedTools } = computeToolOverlap(a.tools, b.tools);
      const contentSimilarity = computeTfIdf(tokenize(a.body), tokenize(b.body));

      const verdict = classifyVerdict(descriptionSimilarity, toolOverlap);

      let recommendation = '';
      if (verdict === 'error') {
        recommendation = `High collision risk between "${a.name}" and "${b.name}". Consider merging or adding disambiguation to descriptions.`;
      } else if (verdict === 'warn') {
        recommendation = `Moderate overlap between "${a.name}" and "${b.name}". Review descriptions for clarity.`;
      }

      pairs.push({
        skillA: a.name,
        skillB: b.name,
        descriptionSimilarity,
        toolOverlap,
        sharedTools,
        contentSimilarity,
        verdict,
        recommendation,
      });
    }
  }

  return {
    skills,
    pairs,
    errors: pairs.filter((p) => p.verdict === 'error'),
    warnings: pairs.filter((p) => p.verdict === 'warn'),
    clean: pairs.filter((p) => p.verdict === 'ok'),
  };
}
