import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { extractEsqlFull, executeEsql, buildEsHeaders, resolveEsUrl } from './esql-utils.js';
import type { EsqlResult } from './esql-utils.js';

/**
 * Normalize a column name for fuzzy comparison.
 * Strips dots, underscores, and lowercases so that
 * `service.name` ≈ `service_name` ≈ `servicename`.
 */
export function normalizeColumnName(name: string): string {
  return name.toLowerCase().replace(/[._]/g, '');
}

/**
 * Common column name synonyms for fuzzy matching.
 * Maps tokens to their equivalent groups so that "count" ≈ "total" ≈ "num",
 * "avg" ≈ "average" ≈ "mean", "sd" ≈ "stddev" ≈ "std_dev", etc.
 */
const TOKEN_SYNONYMS: Record<string, string> = {
  count: 'count', total: 'count', num: 'count', cnt: 'count',
  avg: 'average', average: 'average', mean: 'average',
  sd: 'stddev', stddev: 'stddev', std: 'stddev', deviation: 'stddev',
  rt: 'response_time', response: 'response_time', latency: 'response_time', duration: 'response_time',
  rate: 'rate', rps: 'rate', throughput: 'rate',
  pct: 'percent', percent: 'percent', percentage: 'percent', ratio: 'percent',
  err: 'error', error: 'error', errors: 'error',
  dist: 'distance', distance: 'distance', km: 'distance',
  ts: 'timestamp', timestamp: 'timestamp', time: 'timestamp', bucket: 'timestamp', tbucket: 'timestamp',
};

/**
 * Token-based Jaccard similarity between two column names, with synonym expansion.
 * Splits on common separators, normalizes via synonym table, then computes
 * |intersection| / |union|.
 */
function tokenJaccard(a: string, b: string): number {
  const tokenize = (s: string) => {
    const raw = s.toLowerCase().split(/[._\s-]+/).filter(Boolean);
    return new Set(raw.map((t) => TOKEN_SYNONYMS[t] ?? t));
  };
  const setA = tokenize(a);
  const setB = tokenize(b);
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Fraction of reference columns that appear in generated columns.
 * Uses a two-pass matching strategy:
 * 1. Exact match after normalization (strip dots/underscores, lowercase)
 * 2. Token Jaccard similarity >= 0.5 for remaining unmatched columns
 * Extra columns in generated output don't penalize.
 */
export function columnOverlap(
  refCols: Array<{ name: string }>,
  genCols: Array<{ name: string }>,
): number {
  if (refCols.length === 0) return 1.0;

  const genNormalized = genCols.map((c) => ({
    original: c.name,
    normalized: normalizeColumnName(c.name),
    matched: false,
  }));

  let matched = 0;

  // Pass 1: exact normalized match
  for (const ref of refCols) {
    const refNorm = normalizeColumnName(ref.name);
    const gen = genNormalized.find((g) => !g.matched && g.normalized === refNorm);
    if (gen) {
      gen.matched = true;
      matched++;
    }
  }

  // Pass 2: token Jaccard for remaining unmatched ref columns
  const unmatchedRefs = refCols.filter((ref) => {
    const refNorm = normalizeColumnName(ref.name);
    return !genNormalized.some((g) => g.matched && g.normalized === refNorm);
  });

  for (const ref of unmatchedRefs) {
    let bestScore = 0;
    let bestIdx = -1;
    for (let i = 0; i < genNormalized.length; i++) {
      if (genNormalized[i].matched) continue;
      const score = tokenJaccard(ref.name, genNormalized[i].original);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestScore >= 0.5 && bestIdx >= 0) {
      genNormalized[bestIdx].matched = true;
      matched++;
    }
  }

  return Math.round((matched / refCols.length) * 1000) / 1000;
}

/**
 * Row count similarity using log-scale comparison.
 * This is more forgiving of LIMIT differences (ref=263 vs gen=20 scores ~0.5
 * instead of ~0.08 with linear comparison).
 * Formula: 1 - min(|log(gen+1) - log(ref+1)| / log(ref+1), 1)
 */
export function rowCountSimilarity(refCount: number, genCount: number): number {
  if (refCount === 0 && genCount === 0) return 1.0;
  if (refCount === 0) return genCount === 0 ? 1.0 : 0;
  const logRef = Math.log(refCount + 1);
  const logGen = Math.log(genCount + 1);
  return Math.round(Math.max(0, 1 - Math.abs(logGen - logRef) / logRef) * 1000) / 1000;
}

export class EsqlResultEvaluator implements Evaluator {
  name = 'esql-result';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const golden = context.expected?.esqlGolden;
    if (!golden) {
      return {
        evaluator: this.name,
        score: 0,
        pass: true,
        skipped: true,
        label: 'no_golden',
        explanation: 'No esqlGolden specified; skipping result comparison.',
      };
    }

    const esUrl = resolveEsUrl(context.config);
    if (!esUrl) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'no_es_url',
        explanation: 'No Elasticsearch URL configured',
      };
    }

    const genQuery = extractEsqlFull(context.finalOutput ?? '', context.toolCalls);
    if (!genQuery) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'no_query',
        explanation: 'Could not extract ES|QL query from output',
      };
    }

    const headers = buildEsHeaders(context.config);

    const [refOutcome, genOutcome] = await Promise.all([
      executeEsql(golden, esUrl, headers),
      executeEsql(genQuery, esUrl, headers),
    ]);

    if ('error' in refOutcome && refOutcome.error) {
      // If the golden query fails due to missing index, skip gracefully
      // rather than penalizing the model (infrastructure issue, not model fault)
      if (refOutcome.isIndexNotFound) {
        return {
          evaluator: this.name,
          score: 0,
          pass: true,
          skipped: true,
          label: 'golden_index_missing',
          explanation: `Golden query references missing index — skipping: ${refOutcome.error}`,
          metadata: { goldenQuery: golden, error: refOutcome.error },
        };
      }
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'golden_error',
        explanation: `Golden query failed to execute: ${refOutcome.error}`,
        metadata: { goldenQuery: golden, error: refOutcome.error },
      };
    }

    if ('error' in genOutcome && genOutcome.error) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'gen_error',
        explanation: `Generated query failed to execute: ${genOutcome.error}`,
        metadata: { generatedQuery: genQuery, error: genOutcome.error },
      };
    }

    const ref = refOutcome as EsqlResult;
    const gen = genOutcome as EsqlResult;

    const colScore = columnOverlap(ref.columns, gen.columns);
    const rowScore = rowCountSimilarity(ref.values.length, gen.values.length);
    const score = Math.round(((colScore + rowScore) / 2) * 1000) / 1000;
    const threshold = (context.config?.['esql-result'] as number | undefined) ?? 0.7;

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= 0.9 ? 'match' : score >= 0.5 ? 'partial' : 'mismatch',
      explanation:
        `Column overlap: ${colScore} (${ref.columns.length} ref cols), ` +
        `Row similarity: ${rowScore} (ref=${ref.values.length}, gen=${gen.values.length})`,
      metadata: {
        columnOverlap: colScore,
        rowCountSimilarity: rowScore,
        refColumns: ref.columns.map((c) => c.name),
        genColumns: gen.columns.map((c) => c.name),
        refRowCount: ref.values.length,
        genRowCount: gen.values.length,
        goldenQuery: golden,
        generatedQuery: genQuery,
      },
    };
  }
}
