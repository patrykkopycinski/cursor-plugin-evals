import type { SpanContext } from './spans.js';
import { SERVICE_NAME } from '../core/constants.js';

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{
    key: string;
    value: { stringValue?: string; intValue?: string; boolValue?: boolean };
  }>;
  status: { code: number };
}

function msToNanos(ms: number): string {
  return `${BigInt(ms) * BigInt(1_000_000)}`;
}

function toOtlpAttributes(
  attrs: Record<string, string | number | boolean>,
): OtlpSpan['attributes'] {
  return Object.entries(attrs).map(([key, val]) => {
    if (typeof val === 'boolean') return { key, value: { boolValue: val } };
    if (typeof val === 'number') return { key, value: { intValue: String(val) } };
    return { key, value: { stringValue: String(val) } };
  });
}

function flattenSpans(
  spans: SpanContext[],
  parentSpanId?: string,
): Array<{ span: SpanContext; parentSpanId?: string }> {
  const result: Array<{ span: SpanContext; parentSpanId?: string }> = [];
  for (const span of spans) {
    result.push({ span, parentSpanId });
    result.push(...flattenSpans(span.children, span.spanId));
  }
  return result;
}

function toOtlpSpans(spans: SpanContext[]): OtlpSpan[] {
  return flattenSpans(spans).map(({ span, parentSpanId }) => ({
    traceId: span.traceId,
    spanId: span.spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name: span.name,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: msToNanos(span.startTime),
    endTimeUnixNano: msToNanos(span.endTime ?? span.startTime),
    attributes: toOtlpAttributes(span.attributes),
    status: { code: span.status === 'error' ? 2 : 1 },
  }));
}

export async function exportToOtlp(spans: SpanContext[], endpoint: string): Promise<void> {
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            scope: { name: SERVICE_NAME },
            spans: toOtlpSpans(spans),
          },
        ],
      },
    ],
  };

  const url = endpoint.replace(/\/$/, '') + '/v1/traces';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>');
    throw new Error(`OTLP export failed (${res.status}): ${body}`);
  }
}

interface EsSpanDocument {
  '@timestamp': string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  duration_ms: number;
  status: string;
  attributes: Record<string, string | number | boolean>;
  service: { name: string };
}

function toEsDocuments(spans: SpanContext[]): EsSpanDocument[] {
  return flattenSpans(spans).map(({ span, parentSpanId }) => ({
    '@timestamp': new Date(span.startTime).toISOString(),
    trace_id: span.traceId,
    span_id: span.spanId,
    ...(parentSpanId ? { parent_span_id: parentSpanId } : {}),
    name: span.name,
    duration_ms: (span.endTime ?? span.startTime) - span.startTime,
    status: span.status ?? 'ok',
    attributes: span.attributes,
    service: { name: String(span.attributes['service.name'] ?? SERVICE_NAME) },
  }));
}

export async function exportToElasticsearch(
  spans: SpanContext[],
  esUrl: string,
  apiKey?: string,
): Promise<void> {
  const docs = toEsDocuments(spans);
  if (docs.length === 0) return;

  const index = `traces-${SERVICE_NAME}`;
  const bulkLines: string[] = [];
  for (const doc of docs) {
    bulkLines.push(JSON.stringify({ index: { _index: index } }));
    bulkLines.push(JSON.stringify(doc));
  }
  const body = bulkLines.join('\n') + '\n';

  const headers: Record<string, string> = { 'Content-Type': 'application/x-ndjson' };
  if (apiKey) {
    headers['Authorization'] = `ApiKey ${apiKey}`;
  }

  const url = esUrl.replace(/\/$/, '') + '/_bulk';
  const res = await fetch(url, { method: 'POST', headers, body });

  if (!res.ok) {
    const resBody = await res.text().catch(() => '<unreadable>');
    throw new Error(`Elasticsearch bulk index failed (${res.status}): ${resBody}`);
  }

  const result = (await res.json()) as { errors?: boolean };
  if (result.errors) {
    throw new Error('Elasticsearch bulk index had errors — check the response for details');
  }
}
