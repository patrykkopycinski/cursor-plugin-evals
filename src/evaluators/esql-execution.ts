import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { extractEsql, executeEsql, buildEsHeaders, resolveEsUrl } from './esql-utils.js';

export class EsqlExecutionEvaluator implements Evaluator {
  name = 'esql-execution';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const esUrl = resolveEsUrl(context.config);
    if (!esUrl) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'no_es_url',
        explanation: 'No Elasticsearch URL configured (esUrl, ELASTICSEARCH_URL, or ES_URL required)',
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

    const headers = buildEsHeaders(context.config);
    const outcome = await executeEsql(query, esUrl, headers);

    if ('error' in outcome && outcome.error) {
      const score = outcome.isIndexNotFound ? 0.4 : 0;
      const label = outcome.isIndexNotFound ? 'index_not_found' : 'error';
      return {
        evaluator: this.name,
        score,
        pass: false,
        label,
        explanation: outcome.isIndexNotFound
          ? `Valid syntax but wrong index: ${outcome.error}`
          : `Query failed: ${outcome.error}`,
        metadata: { query, error: outcome.error },
      };
    }

    return {
      evaluator: this.name,
      score: 1.0,
      pass: true,
      label: 'executed',
      explanation: `Query executed successfully (${outcome.columns.length} columns, ${outcome.values.length} rows)`,
      metadata: {
        query,
        columnCount: outcome.columns.length,
        rowCount: outcome.values.length,
      },
    };
  }
}
