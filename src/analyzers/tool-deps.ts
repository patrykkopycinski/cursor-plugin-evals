export interface ToolDepResult { valid: boolean; missing: string[]; available: string[]; expected: string[]; }

export function validateToolDependencies(expectedTools: string[], availableTools: string[]): ToolDepResult {
  const available = new Set(availableTools);
  const missing = expectedTools.filter(t => !available.has(t));
  return { valid: missing.length === 0, missing, available: availableTools, expected: expectedTools };
}
