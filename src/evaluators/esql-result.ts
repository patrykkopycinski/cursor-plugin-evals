import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { extractEsql, executeEsql, buildEsHeaders, resolveEsUrl } from './esql-utils.js';
import type { EsqlResult } from './esql-utils.js';

/**
 * Fraction of reference columns that appear in generated columns (case-insensitive).
 * Extra columns in generated output don't penalize.
 */
export function columnOverlap(
  refCols: Array<{ name: string }>,
  genCols: Array<{ name: string }>,
): number {
  if (refCols.length === 0) return 1.0;
  const genSet = new Set(genCols.map((c) => c.name.toLowerCase()));
  const overlap = refCols.filter((c) => genSet.has(c.name.toLowerCase())).length;
  return Math.round((overlap / refCols.length) * 1000) / 1000;
}

/**
 * Row count similarity: 1 - min(|genRows - refRows| / refRows, 1).
 */
export function rowCountSimilarity(refCount: number, genCount: number): number {
  if (refCount === 0 && genCount === 0) return 1.0;
  if (refCount === 0) return 0;
  return Math.round(Math.max(0, 1 - Math.abs(genCount - refCount) / refCount) * 1000) / 1000;
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

    const genQuery = extractEsql(context.finalOutput ?? '');
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
