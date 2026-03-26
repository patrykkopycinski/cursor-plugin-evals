import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { extractEsql } from './esql-utils.js';

/**
 * ES|QL command equivalence classes.
 * If a pattern mentions one command, its equivalent is also accepted.
 */
export const ESQL_EQUIVALENCES: [string, string][] = [
  ['LOOKUP JOIN', 'ENRICH'],
  ['DISSECT', 'GROK'],
  ['MATCH', 'QSTR'],
  ['MV_EXPAND', 'MV_SORT'],
];

function matchesWithEquivalence(query: string, pattern: string): boolean {
  try {
    if (new RegExp(pattern, 'i').test(query)) return true;
  } catch {
    if (query.toLowerCase().includes(pattern.toLowerCase())) return true;
  }

  for (const [a, b] of ESQL_EQUIVALENCES) {
    if (pattern.toUpperCase().includes(a)) {
      const altPattern = pattern.replace(new RegExp(a.replace(/\s+/g, '\\s+'), 'gi'), b);
      try {
        if (new RegExp(altPattern, 'i').test(query)) return true;
      } catch {
        if (query.toLowerCase().includes(altPattern.toLowerCase())) return true;
      }
    }
    if (pattern.toUpperCase().includes(b)) {
      const altPattern = pattern.replace(new RegExp(b.replace(/\s+/g, '\\s+'), 'gi'), a);
      try {
        if (new RegExp(altPattern, 'i').test(query)) return true;
      } catch {
        if (query.toLowerCase().includes(altPattern.toLowerCase())) return true;
      }
    }
  }

  return false;
}

export class EsqlPatternEvaluator implements Evaluator {
  name = 'esql-pattern';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const patterns = context.expected?.responseContains ?? [];

    if (patterns.length === 0) {
      return {
        evaluator: this.name,
        score: 1,
        pass: true,
        skipped: true,
        label: 'no_patterns',
        explanation: 'No patterns specified; skipping.',
      };
    }

    const query = extractEsql(context.finalOutput ?? '');
    if (!query) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'no_query',
        explanation: 'Could not extract ES|QL query from output',
      };
    }

    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const pattern of patterns) {
      if (matchesWithEquivalence(query, pattern)) {
        matched.push(pattern);
      } else {
        unmatched.push(pattern);
      }
    }

    const score = Math.round((matched.length / patterns.length) * 1000) / 1000;
    const threshold = (context.config?.['esql-pattern'] as number | undefined) ?? 0.7;

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= 1 ? 'all_matched' : score > 0 ? 'partial' : 'none_matched',
      explanation:
        unmatched.length > 0
          ? `${matched.length}/${patterns.length} patterns matched. Missing: ${unmatched.join(', ')}`
          : `All ${patterns.length} patterns matched`,
      metadata: { matched, unmatched, query },
    };
  }
}
