export interface SkillTurn { role: 'user' | 'assistant' | 'system'; content: string; }

export function buildMultiTurnPrompt(turns: SkillTurn[]): string {
  if (turns.length === 0) return '';
  if (turns.length === 1) return turns[0].content;
  return turns.map(t => {
    const prefix = t.role === 'user' ? 'User' : t.role === 'assistant' ? 'Assistant' : 'System';
    return `${prefix}: ${t.content}`;
  }).join('\n\n');
}

export function extractLastUserPrompt(turns: SkillTurn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') return turns[i].content;
  }
  return '';
}

export function turnCountByRole(turns: SkillTurn[]): Record<string, number> {
  const counts: Record<string, number> = { user: 0, assistant: 0, system: 0 };
  for (const t of turns) counts[t.role] = (counts[t.role] ?? 0) + 1;
  return counts;
}
