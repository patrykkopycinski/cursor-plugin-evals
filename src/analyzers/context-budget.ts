import type { SkillComponent } from '../core/types.js';

export interface SkillBudgetEntry { name: string; charCount: number; estimatedTokens: number; lineCount: number; bloated: boolean; }
export interface ContextBudgetReport { skills: SkillBudgetEntry[]; totalEstimatedTokens: number; contextWindow: number; remainingTokens: number; utilizationPercent: number; warnings: string[]; }

const CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const BLOAT_THRESHOLD_TOKENS = 1500;
const DEFAULT_WARNING_THRESHOLD = 0.25;

export function analyzeContextBudget(
  skills: SkillComponent[],
  options?: { contextWindow?: number; warningThreshold?: number; bloatThreshold?: number },
): ContextBudgetReport {
  const contextWindow = options?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const warningThreshold = options?.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
  const bloatThreshold = options?.bloatThreshold ?? BLOAT_THRESHOLD_TOKENS;

  const entries: SkillBudgetEntry[] = skills.map(skill => {
    const body = skill.body ?? '';
    const charCount = body.length;
    const estimatedTokens = Math.ceil(charCount / CHARS_PER_TOKEN);
    const lineCount = body.split('\n').length;
    return { name: skill.name, charCount, estimatedTokens, lineCount, bloated: estimatedTokens > bloatThreshold };
  });

  const totalEstimatedTokens = entries.reduce((s, e) => s + e.estimatedTokens, 0);
  const remainingTokens = contextWindow - totalEstimatedTokens;
  const utilizationPercent = contextWindow > 0 ? (totalEstimatedTokens / contextWindow) * 100 : 0;

  const warnings: string[] = [];
  if (utilizationPercent > warningThreshold * 100) {
    warnings.push(`Skills consume ${utilizationPercent.toFixed(1)}% of context window (${totalEstimatedTokens} / ${contextWindow} tokens)`);
  }
  for (const e of entries) {
    if (e.bloated) warnings.push(`Skill "${e.name}" is bloated: ~${e.estimatedTokens} tokens (${e.lineCount} lines). Recommended: <${bloatThreshold} tokens.`);
  }

  return { skills: entries, totalEstimatedTokens, contextWindow, remainingTokens, utilizationPercent, warnings };
}
