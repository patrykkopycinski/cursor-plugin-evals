export interface FailureCluster {
  pattern: string;
  count: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  traceIds: string[];
  commonTools: string[];
  avgScore: number;
  suggestedFix?: string;
}

export interface ClusteringConfig {
  endpoint: string;
  apiKey?: string;
  index?: string;
  timeRange?: { from: string; to: string };
  minCount?: number;
}

interface EsHit {
  _source?: {
    'trace.id'?: string;
    trace_id?: string;
  };
}

interface EsAggBucket {
  key: string;
  doc_count: number;
  sample_traces?: { hits: { hits: EsHit[] } };
  common_tools?: { buckets: Array<{ key: string; doc_count: number }> };
  only_failures?: {
    count?: { value: number };
    sample_traces?: { hits: { hits: EsHit[] } };
  };
}

interface EsResponse {
  aggregations?: {
    by_error_type?: { buckets: EsAggBucket[] };
    by_tool_failure?: { buckets: EsAggBucket[] };
  };
}

function classifySeverity(count: number): FailureCluster['severity'] {
  if (count > 50) return 'critical';
  if (count > 20) return 'high';
  if (count > 5) return 'medium';
  return 'low';
}

function extractTraceIds(hits: EsHit[]): string[] {
  return hits
    .map((h) => h._source?.['trace.id'] ?? h._source?.trace_id ?? '')
    .filter(Boolean);
}

function suggestFix(pattern: string, commonTools: string[]): string | undefined {
  const lowerPattern = pattern.toLowerCase();
  if (lowerPattern.includes('timeout')) return 'Increase timeout or add retry logic for this operation.';
  if (lowerPattern.includes('auth') || lowerPattern.includes('unauthorized')) return 'Review authentication configuration and token expiry.';
  if (lowerPattern.includes('not_found') || lowerPattern.includes('404')) return 'Validate resource existence before tool invocation.';
  if (commonTools.length > 0) return `Review error handling in tool: ${commonTools[0]}.`;
  return undefined;
}

function buildEsHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `ApiKey ${apiKey}`;
  return headers;
}

/**
 * Query ES for failure patterns using aggregations.
 * Uses significant_terms on error attributes and tool names.
 */
export async function clusterFailures(config: ClusteringConfig): Promise<FailureCluster[]> {
  const index = config.index ?? 'traces-apm*,traces-generic.otel-*';
  const minCount = config.minCount ?? 3;

  const timeFilter = config.timeRange
    ? [{ range: { '@timestamp': { gte: config.timeRange.from, lte: config.timeRange.to } } }]
    : [];

  const query = {
    size: 0,
    query: {
      bool: {
        must: [
          ...timeFilter,
          {
            bool: {
              should: [
                { bool: { must: [{ exists: { field: 'event.outcome' } }, { term: { 'event.outcome': 'failure' } }] } },
                { term: { 'status.code': 2 } },
                { term: { status_code: 'ERROR' } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    },
    aggs: {
      by_error_type: {
        terms: { field: 'error.type', size: 20 },
        aggs: {
          sample_traces: { top_hits: { size: 5, _source: ['trace.id', 'trace_id'] } },
          common_tools: { terms: { field: 'span.name', size: 10 } },
          avg_duration: { avg: { field: 'span.duration.us' } },
        },
      },
      by_tool_failure: {
        terms: { field: 'span.name', size: 20 },
        aggs: {
          only_failures: {
            filter: {
              bool: {
                should: [
                  { term: { 'event.outcome': 'failure' } },
                  { term: { 'status.code': 2 } },
                  { term: { status_code: 'ERROR' } },
                ],
                minimum_should_match: 1,
              },
            },
            aggs: {
              count: { value_count: { field: 'span.id' } },
              sample_traces: { top_hits: { size: 5, _source: ['trace.id', 'trace_id'] } },
            },
          },
        },
      },
    },
  };

  const url = `${config.endpoint}/${index}/_search`;
  const response = await fetch(url, {
    method: 'POST',
    headers: buildEsHeaders(config.apiKey),
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ES cluster query failed: ${response.status} — ${body}`);
  }

  const data = (await response.json()) as EsResponse;
  const clusters: FailureCluster[] = [];

  const errorTypeBuckets = data.aggregations?.by_error_type?.buckets ?? [];
  for (const bucket of errorTypeBuckets) {
    if (bucket.doc_count < minCount) continue;
    const traceIds = extractTraceIds(bucket.sample_traces?.hits.hits ?? []);
    const commonTools = (bucket.common_tools?.buckets ?? []).map((b) => b.key);
    clusters.push({
      pattern: `Error type: ${bucket.key}`,
      count: bucket.doc_count,
      severity: classifySeverity(bucket.doc_count),
      traceIds,
      commonTools,
      avgScore: 0,
      suggestedFix: suggestFix(bucket.key, commonTools),
    });
  }

  const toolFailureBuckets = data.aggregations?.by_tool_failure?.buckets ?? [];
  for (const bucket of toolFailureBuckets) {
    const failureCount = bucket.only_failures?.count?.value ?? 0;
    if (failureCount < minCount) continue;
    const traceIds = extractTraceIds(bucket.only_failures?.sample_traces?.hits.hits ?? []);
    clusters.push({
      pattern: `Tool failure: ${bucket.key}`,
      count: failureCount,
      severity: classifySeverity(failureCount),
      traceIds,
      commonTools: [bucket.key],
      avgScore: 0,
      suggestedFix: suggestFix(bucket.key, [bucket.key]),
    });
  }

  return clusters.sort((a, b) => b.count - a.count);
}

interface LowScoreEsResponse {
  hits?: {
    hits: Array<{
      _source?: {
        'trace.id'?: string;
        trace_id?: string;
        'span.name'?: string;
        'gen_ai.evaluation.score.value'?: number;
        '@timestamp'?: string;
      };
    }>;
  };
}

/**
 * Query ES for traces with low evaluation scores.
 * Returns traces where eval event scores are below threshold.
 */
export async function findLowScoringTraces(
  config: ClusteringConfig,
  scoreThreshold = 0.5,
): Promise<Array<{ traceId: string; score: number; tools: string[]; timestamp: string }>> {
  const index = config.index ?? 'traces-apm*,traces-generic.otel-*';

  const timeFilter = config.timeRange
    ? [{ range: { '@timestamp': { gte: config.timeRange.from, lte: config.timeRange.to } } }]
    : [];

  const query = {
    size: 100,
    sort: [{ 'gen_ai.evaluation.score.value': { order: 'asc' } }],
    query: {
      bool: {
        should: [
          {
            bool: {
              must: [
                ...timeFilter,
                { range: { 'gen_ai.evaluation.score.value': { lt: scoreThreshold } } },
              ],
            },
          },
          {
            bool: {
              must: [
                ...timeFilter,
                { term: { 'eval.test.pass': false } },
              ],
            },
          },
        ],
        minimum_should_match: 1,
      },
    },
    _source: ['trace.id', 'trace_id', 'span.name', 'gen_ai.evaluation.score.value', '@timestamp'],
  };

  const url = `${config.endpoint}/${index}/_search`;
  const response = await fetch(url, {
    method: 'POST',
    headers: buildEsHeaders(config.apiKey),
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ES low-score query failed: ${response.status} — ${body}`);
  }

  const data = (await response.json()) as LowScoreEsResponse;
  const hits = data.hits?.hits ?? [];

  return hits.map((hit) => ({
    traceId: hit._source?.['trace.id'] ?? hit._source?.trace_id ?? '',
    score: hit._source?.['gen_ai.evaluation.score.value'] ?? 0,
    tools: hit._source?.['span.name'] ? [hit._source['span.name']] : [],
    timestamp: hit._source?.['@timestamp'] ?? new Date().toISOString(),
  })).filter((t) => t.traceId);
}
