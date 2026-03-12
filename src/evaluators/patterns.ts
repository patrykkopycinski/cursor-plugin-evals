export const RAG_METRIC_PATTERNS = ['Precision@K', 'Recall@K', 'F1@K'] as const;

const RAG_PATTERN_RE = /^(Precision|Recall|F1)@(\d+)$/i;

export function isKSpecificRagEvaluator(name: string): boolean {
  return RAG_PATTERN_RE.test(name);
}

export function matchesEvaluatorPattern(evaluatorName: string, pattern: string): boolean {
  if (evaluatorName === pattern) return true;

  if ((RAG_METRIC_PATTERNS as readonly string[]).includes(pattern)) {
    const basePattern = pattern.replace(/@K$/i, '');
    const match = evaluatorName.match(RAG_PATTERN_RE);
    return match !== null && match[1].toLowerCase() === basePattern.toLowerCase();
  }

  return false;
}

export function expandPatternsToEvaluators(patterns: string[], evaluatorNames: string[]): string[] {
  const result = new Set<string>();

  for (const pattern of patterns) {
    for (const name of evaluatorNames) {
      if (matchesEvaluatorPattern(name, pattern)) {
        result.add(name);
      }
    }
  }

  return [...result];
}
