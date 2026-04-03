import type { TraceSource, ParsedTrace, ParsedSpan, SpanEvent, TraceSourceConfig } from './types.js';

// ---------------------------------------------------------------------------
// ES query / response types (minimal — only what we use)
// ---------------------------------------------------------------------------

interface EsHit {
  _index: string;
  _source: Record<string, unknown>;
}

interface EsSearchResponse {
  hits: {
    hits: EsHit[];
    total?: { value: number } | number;
  };
  error?: { reason?: string; type?: string };
}

// ---------------------------------------------------------------------------
// Index patterns for different EDOT pipelines
// ---------------------------------------------------------------------------

/** APM intake pipeline — ECS-mapped documents */
const APM_INDEX = 'traces-apm*';
/** OTLP native pipeline — OTel-native documents (EDOT collector direct OTLP) */
const OTLP_INDEX = 'traces-generic.otel-*';
/** Combined default: search both pipelines */
const DEFAULT_INDEX = `${APM_INDEX},${OTLP_INDEX}`;

// ---------------------------------------------------------------------------
// Field name mappings per document format
// ---------------------------------------------------------------------------

/** Detect document format from field presence */
function detectDocFormat(doc: Record<string, unknown>): 'apm' | 'otlp' {
  // OTLP-native docs use snake_case OTel fields
  if (doc['trace_id'] !== undefined || doc['span_id'] !== undefined) return 'otlp';
  // OTLP docs may nest under resource.attributes
  if (doc['resource'] !== undefined && typeof doc['resource'] === 'object') return 'otlp';
  // APM docs use dot-notation ECS fields
  if (doc['trace.id'] !== undefined || doc['span.id'] !== undefined) return 'apm';
  // Nested ECS objects
  if (doc['trace'] !== undefined || doc['span'] !== undefined) return 'apm';
  // Default to APM
  return 'apm';
}

// ---------------------------------------------------------------------------
// Nested field accessor (handles both 'a.b.c' dotted keys and nested objects)
// ---------------------------------------------------------------------------

function getField(doc: Record<string, unknown>, ...paths: string[]): unknown {
  for (const path of paths) {
    // Try direct key first (e.g., 'trace.id' as a flat key)
    if (path in doc) return doc[path];

    // Try nested traversal (e.g., doc.trace.id)
    const parts = path.split('.');
    let current: unknown = doc;
    let found = true;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') {
        found = false;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (found && current !== undefined) return current;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// ElasticsearchTraceSource
// ---------------------------------------------------------------------------

export class ElasticsearchTraceSource implements TraceSource {
  readonly name = 'elasticsearch';

  private readonly endpoint: string;
  private readonly index: string;
  private readonly authHeader: string | null;
  private readonly defaultServiceName?: string;
  private readonly defaultTimeRange?: { from: string; to: string };
  private readonly docFormat: 'apm' | 'otlp' | 'auto';

  constructor(config: TraceSourceConfig) {
    if (!config.endpoint) {
      throw new Error('ElasticsearchTraceSource: config.endpoint is required');
    }
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.index = config.index ?? DEFAULT_INDEX;
    this.docFormat = config.docFormat ?? 'auto';
    this.defaultServiceName = config.serviceName;
    this.defaultTimeRange = config.timeRange;

    // Build auth header
    if (config.apiKey) {
      this.authHeader = `ApiKey ${config.apiKey}`;
    } else if (config.username && config.password) {
      const encoded = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      this.authHeader = `Basic ${encoded}`;
    } else {
      this.authHeader = null;
    }
  }

  async getTrace(traceId: string): Promise<ParsedTrace | null> {
    // Query across all trace ID field conventions
    const query = {
      size: 1000,
      query: {
        bool: {
          should: [
            { term: { 'trace.id': traceId } },          // APM/ECS flat
            { term: { 'trace_id': traceId } },           // OTLP native
            { term: { 'traceId': traceId } },            // alternative
            { term: { 'TraceId': traceId } },            // some exporters
          ],
          minimum_should_match: 1,
        },
      },
      sort: [{ '@timestamp': { order: 'asc' } }],
    };

    const hits = await this.searchRaw(query);
    if (hits.length === 0) return null;
    return this.hitsToTrace(traceId, hits);
  }

  async listTraces(options?: {
    limit?: number;
    serviceName?: string;
    timeRange?: { from: string; to: string };
  }): Promise<ParsedTrace[]> {
    const limit = options?.limit ?? 100;
    const serviceName = options?.serviceName ?? this.defaultServiceName;
    const timeRange = options?.timeRange ?? this.defaultTimeRange;

    const must: unknown[] = [];

    if (serviceName) {
      // Service name lives in different fields depending on the pipeline
      must.push({
        bool: {
          should: [
            { term: { 'service.name': serviceName } },                        // APM/ECS
            { term: { 'resource.attributes.service\\.name': serviceName } },  // OTLP nested
            { term: { 'resource.service.name': serviceName } },               // OTLP flat
          ],
          minimum_should_match: 1,
        },
      });
    }

    if (timeRange) {
      must.push({
        range: {
          '@timestamp': { gte: timeRange.from, lte: timeRange.to },
        },
      });
    }

    // Fetch root spans (no parent) to discover trace IDs.
    // OTLP exporters may set parent_span_id to "" instead of omitting it,
    // so we check for both missing AND empty string values.
    must.push({
      bool: {
        should: [
          // Case 1: parent fields don't exist at all
          {
            bool: {
              must_not: [
                { exists: { field: 'parent.id' } },
                { exists: { field: 'parent_span_id' } },
                { exists: { field: 'parentSpanId' } },
              ],
            },
          },
          // Case 2: OTLP parent_span_id exists but is empty string (root span)
          { term: { 'parent_span_id': '' } },
          { term: { 'parentSpanId': '' } },
        ],
        minimum_should_match: 1,
      },
    });

    const query = {
      size: limit,
      query: must.length > 0 ? { bool: { must } } : { match_all: {} },
      sort: [{ '@timestamp': { order: 'desc' } }],
      _source: [
        'trace.id', 'trace_id', 'traceId', 'TraceId', '@timestamp',
      ],
    };

    const rootHits = await this.searchRaw(query);

    // Collect unique trace IDs from all field conventions
    const traceIds = new Set<string>();
    for (const hit of rootHits) {
      const doc = hit._source;
      const tid =
        (getField(doc, 'trace.id') as string | undefined) ??
        (doc['trace_id'] as string | undefined) ??
        (doc['traceId'] as string | undefined) ??
        (doc['TraceId'] as string | undefined);
      if (tid) traceIds.add(tid);
    }

    // Fetch full traces in parallel (batched to avoid overwhelming ES)
    const results: ParsedTrace[] = [];
    const ids = Array.from(traceIds).slice(0, limit);
    const chunkSize = 10;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const settled = await Promise.allSettled(chunk.map((id) => this.getTrace(id)));
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled' && outcome.value !== null) {
          results.push(outcome.value);
        } else if (outcome.status === 'rejected') {
          console.warn('[ElasticsearchTraceSource] Failed to fetch trace:', outcome.reason);
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async searchRaw(body: Record<string, unknown>): Promise<EsHit[]> {
    const url = `${this.endpoint}/${this.index}/_search`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.authHeader) headers['Authorization'] = this.authHeader;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint = (err as Error)?.name === 'TimeoutError' ? ' (30s timeout)' : '';
      throw new Error(`[ElasticsearchTraceSource] Network error querying "${url}"${hint}: ${msg}`);
    }

    let json: EsSearchResponse;
    try {
      json = (await response.json()) as EsSearchResponse;
    } catch (_e) {
      throw new Error(
        `[ElasticsearchTraceSource] Non-JSON response from ES (status ${response.status})`,
      );
    }

    if (!response.ok) {
      const reason = json.error?.reason ?? `HTTP ${response.status}`;
      throw new Error(`[ElasticsearchTraceSource] ES query failed: ${reason}`);
    }

    return json.hits?.hits ?? [];
  }

  private hitsToTrace(traceId: string, hits: EsHit[]): ParsedTrace {
    const spans: ParsedSpan[] = hits.map((hit) => this.docToSpan(hit));

    // Build tree
    const spanMap = new Map<string, ParsedSpan>();
    for (const span of spans) {
      spanMap.set(span.spanId, span);
    }
    const roots: ParsedSpan[] = [];
    for (const span of spans) {
      if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
        spanMap.get(span.parentSpanId)!.children.push(span);
      } else {
        roots.push(span);
      }
    }

    const rootSpan = roots[0] ?? null;

    // Service name extraction: try ECS → OTLP resource → any span
    const serviceName = this.extractServiceName(hits) ?? 'unknown';

    const startTime = spans.length > 0 ? Math.min(...spans.map((s) => s.startTime)) : 0;
    const endTime = spans.length > 0 ? Math.max(...spans.map((s) => s.endTime)) : 0;

    return {
      traceId,
      spans,
      rootSpan,
      serviceName,
      startTime,
      endTime,
      duration: endTime - startTime,
    };
  }

  private extractServiceName(hits: EsHit[]): string | undefined {
    for (const hit of hits) {
      const doc = hit._source;
      // APM/ECS
      const ecs = getField(doc, 'service.name') as string | undefined;
      if (ecs) return ecs;
      // OTLP native — resource.attributes may be nested or flat
      const otlpNested = getField(doc, 'resource.attributes.service.name') as string | undefined;
      if (otlpNested) return otlpNested;
      // Some OTLP exporters use resource.service.name
      const otlpFlat = getField(doc, 'resource.service.name') as string | undefined;
      if (otlpFlat) return otlpFlat;
    }
    return undefined;
  }

  private docToSpan(hit: EsHit): ParsedSpan {
    const doc = hit._source;
    const format = this.docFormat === 'auto' ? detectDocFormat(doc) : this.docFormat;

    if (format === 'otlp') {
      return this.otlpDocToSpan(doc, hit._index);
    }
    return this.apmDocToSpan(doc);
  }

  // ---------------------------------------------------------------------------
  // APM / ECS document → ParsedSpan
  // ---------------------------------------------------------------------------

  private apmDocToSpan(doc: Record<string, unknown>): ParsedSpan {
    const spanId =
      (getField(doc, 'span.id') as string | undefined) ??
      (doc['spanId'] as string | undefined) ??
      'unknown';

    const parentSpanId =
      (getField(doc, 'parent.id') as string | undefined) ??
      (doc['parentSpanId'] as string | undefined);

    const name =
      (getField(doc, 'span.name') as string | undefined) ??
      (getField(doc, 'transaction.name') as string | undefined) ??
      (doc['name'] as string | undefined) ??
      'unknown';

    const tsRaw = doc['@timestamp'] as string | number | undefined;
    const startTime = tsRaw ? new Date(tsRaw).getTime() : 0;

    const durationUs =
      (getField(doc, 'span.duration.us') as number | undefined) ??
      (getField(doc, 'transaction.duration.us') as number | undefined) ??
      0;
    const durationMs = durationUs / 1000;
    const endTime = startTime + durationMs;

    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(doc)) {
      attributes[key] = value;
    }

    const hasError =
      doc['error'] != null ||
      (getField(doc, 'event.outcome') as string | undefined) === 'failure' ||
      (getField(doc, 'span.outcome') as string | undefined) === 'failure' ||
      (getField(doc, 'transaction.outcome') as string | undefined) === 'failure';

    return {
      spanId,
      parentSpanId,
      name,
      startTime,
      endTime,
      duration: durationMs,
      attributes,
      events: [],
      status: hasError ? 'error' : 'unset',
      children: [],
    };
  }

  // ---------------------------------------------------------------------------
  // OTLP native document → ParsedSpan
  // (Documents from EDOT collector with OTLP-native indexing, data streams like
  //  traces-generic.otel-default)
  // ---------------------------------------------------------------------------

  private otlpDocToSpan(doc: Record<string, unknown>, index: string): ParsedSpan {
    const spanId =
      (doc['span_id'] as string | undefined) ??
      (doc['spanId'] as string | undefined) ??
      (getField(doc, 'span.id') as string | undefined) ??
      'unknown';

    const parentSpanId =
      (doc['parent_span_id'] as string | undefined) ??
      (doc['parentSpanId'] as string | undefined) ??
      (getField(doc, 'parent.id') as string | undefined) ??
      undefined;

    const name =
      (doc['name'] as string | undefined) ??
      (doc['span_name'] as string | undefined) ??
      (getField(doc, 'span.name') as string | undefined) ??
      'unknown';

    const tsRaw = doc['@timestamp'] as string | number | undefined;
    const startTime = tsRaw ? new Date(tsRaw).getTime() : 0;

    // OTLP stores duration in nanoseconds; some exporters use microseconds
    let durationMs = 0;
    const durationNs = doc['duration'] as number | undefined;
    if (durationNs !== undefined) {
      // Heuristic: if > 1e12, it's nanoseconds; if > 1e9, microseconds; else milliseconds
      if (durationNs > 1e12) {
        durationMs = durationNs / 1e6;
      } else if (durationNs > 1e6) {
        durationMs = durationNs / 1e3;
      } else {
        durationMs = durationNs;
      }
    } else {
      // Fallback to end_time - start_time if available
      const endTimeNs = doc['end_time'] as number | undefined;
      const startTimeNs = doc['start_time'] as number | undefined;
      if (endTimeNs !== undefined && startTimeNs !== undefined) {
        durationMs = (endTimeNs - startTimeNs) / 1e6;
      }
    }
    const endTime = startTime + durationMs;

    // Merge all attributes: resource.attributes + scope.attributes + span attributes
    const attributes: Record<string, unknown> = {};

    // Copy all top-level fields
    for (const [key, value] of Object.entries(doc)) {
      if (key === 'resource' || key === 'scope' || key === 'attributes') continue;
      attributes[key] = value;
    }

    // Flatten resource.attributes (OTLP native)
    const resource = doc['resource'] as Record<string, unknown> | undefined;
    if (resource) {
      const resAttrs = resource['attributes'] as Record<string, unknown> | undefined;
      if (resAttrs) {
        for (const [key, value] of Object.entries(resAttrs)) {
          attributes[`resource.${key}`] = value;
        }
      }
    }

    // Flatten span attributes
    const spanAttrs = doc['attributes'] as Record<string, unknown> | undefined;
    if (spanAttrs) {
      for (const [key, value] of Object.entries(spanAttrs)) {
        attributes[key] = value;
      }
    }

    // OTLP status code: 0=UNSET, 1=OK, 2=ERROR
    const statusCode =
      (getField(doc, 'status.code') as number | string | undefined) ??
      (doc['status_code'] as number | string | undefined);
    let status: 'ok' | 'error' | 'unset' = 'unset';
    if (statusCode === 2 || statusCode === 'ERROR' || statusCode === 'STATUS_CODE_ERROR') {
      status = 'error';
    } else if (statusCode === 1 || statusCode === 'OK' || statusCode === 'STATUS_CODE_OK') {
      status = 'ok';
    }

    // Extract events array if present (OTLP native stores inline events)
    const events: SpanEvent[] = [];
    const rawEvents = doc['events'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(rawEvents)) {
      for (const evt of rawEvents) {
        const evtName = (evt['name'] as string | undefined) ?? 'event';
        const evtTsRaw = evt['time_unix_nano'] as number | undefined;
        const evtTs = evtTsRaw ? evtTsRaw / 1e6 : startTime;
        const evtAttrs = (evt['attributes'] as Record<string, unknown>) ?? {};
        events.push({ name: evtName, timestamp: evtTs, attributes: evtAttrs });
      }
    }

    return {
      spanId,
      parentSpanId: parentSpanId || undefined, // normalize empty string
      name,
      startTime,
      endTime,
      duration: durationMs,
      attributes,
      events,
      status,
      children: [],
    };
  }
}

export function createElasticsearchTraceSource(
  config: TraceSourceConfig,
): ElasticsearchTraceSource {
  return new ElasticsearchTraceSource(config);
}
