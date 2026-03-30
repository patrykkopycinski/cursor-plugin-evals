import type { ParsedTrace, ParsedSpan, SpanEvent } from './types.js';

// ---------------------------------------------------------------------------
// Jaeger JSON format types
// ---------------------------------------------------------------------------

interface JaegerTag {
  key: string;
  type: string;
  value: unknown;
}

interface JaegerLog {
  timestamp: number; // microseconds
  fields: JaegerTag[];
}

interface JaegerReference {
  refType: string;
  traceID: string;
  spanID: string;
}

interface JaegerSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  startTime: number; // microseconds
  duration: number;  // microseconds
  tags?: JaegerTag[];
  logs?: JaegerLog[];
  references?: JaegerReference[];
  process?: {
    serviceName?: string;
    tags?: JaegerTag[];
  };
}

interface JaegerTrace {
  traceID: string;
  spans: JaegerSpan[];
  processes?: Record<string, { serviceName?: string; tags?: JaegerTag[] }>;
}

interface JaegerResponse {
  data?: JaegerTrace[];
}

// ---------------------------------------------------------------------------
// OTLP JSON format types
// ---------------------------------------------------------------------------

interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: OtlpAnyValue[] };
  kvlistValue?: { values?: OtlpKeyValue[] };
}

interface OtlpEvent {
  timeUnixNano?: string;
  name?: string;
  attributes?: OtlpKeyValue[];
}

interface OtlpStatus {
  code?: number | string; // 0=unset, 1=ok, 2=error
  message?: string;
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: OtlpKeyValue[];
  events?: OtlpEvent[];
  status?: OtlpStatus;
}

interface OtlpScopeSpans {
  spans?: OtlpSpan[];
}

interface OtlpResourceSpan {
  resource?: { attributes?: OtlpKeyValue[] };
  scopeSpans?: OtlpScopeSpans[];
  // OTLP 0.9 compat
  instrumentationLibrarySpans?: OtlpScopeSpans[];
}

interface OtlpPayload {
  resourceSpans?: OtlpResourceSpan[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nanosToMs(ns: string | number | undefined): number {
  if (ns == null) return 0;
  // BigInt to avoid precision loss for large nanosecond values
  const n = typeof ns === 'string' ? BigInt(ns) : BigInt(Math.round(Number(ns)));
  return Number(n / 1_000_000n);
}

function microToMs(us: number): number {
  return us / 1000;
}

function jaegerTagsToRecord(tags?: JaegerTag[]): Record<string, unknown> {
  if (!tags) return {};
  const record: Record<string, unknown> = {};
  for (const tag of tags) {
    record[tag.key] = tag.value;
  }
  return record;
}

function otlpValueToJs(val: OtlpAnyValue): unknown {
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.intValue !== undefined)
    return typeof val.intValue === 'string' ? parseInt(val.intValue, 10) : val.intValue;
  if (val.doubleValue !== undefined) return val.doubleValue;
  if (val.boolValue !== undefined) return val.boolValue;
  if (val.arrayValue?.values) return val.arrayValue.values.map(otlpValueToJs);
  if (val.kvlistValue?.values) {
    const rec: Record<string, unknown> = {};
    for (const kv of val.kvlistValue.values) {
      rec[kv.key] = otlpValueToJs(kv.value);
    }
    return rec;
  }
  return null;
}

function otlpAttrsToRecord(attrs?: OtlpKeyValue[]): Record<string, unknown> {
  if (!attrs) return {};
  const record: Record<string, unknown> = {};
  for (const kv of attrs) {
    record[kv.key] = otlpValueToJs(kv.value);
  }
  return record;
}

function otlpStatusToState(status?: OtlpStatus): 'ok' | 'error' | 'unset' {
  if (!status) return 'unset';
  const code = status.code;
  if (code === 1 || code === 'STATUS_CODE_OK') return 'ok';
  if (code === 2 || code === 'STATUS_CODE_ERROR') return 'error';
  return 'unset';
}

function buildSpanTree(spans: ParsedSpan[]): ParsedSpan[] {
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
  return roots;
}

function assembleTrace(traceId: string, spans: ParsedSpan[], serviceName: string): ParsedTrace {
  const rootSpans = buildSpanTree(spans);
  const rootSpan = rootSpans[0] ?? null;

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

// ---------------------------------------------------------------------------
// Jaeger parser
// ---------------------------------------------------------------------------

function parseJaegerSpan(
  span: JaegerSpan,
  processes?: Record<string, { serviceName?: string; tags?: JaegerTag[] }>,
): ParsedSpan {
  const attributes = jaegerTagsToRecord(span.tags);
  const processId = (span as unknown as Record<string, string>)['processID'];
  if (processId && processes?.[processId]) {
    const procTags = jaegerTagsToRecord(processes[processId].tags);
    Object.assign(attributes, { 'service.name': processes[processId].serviceName, ...procTags });
  } else if (span.process) {
    const procTags = jaegerTagsToRecord(span.process.tags);
    Object.assign(attributes, {
      'service.name': span.process.serviceName,
      ...procTags,
    });
  }

  const events: SpanEvent[] = (span.logs ?? []).map((log) => ({
    name: (jaegerTagsToRecord(log.fields)['event'] as string | undefined) ?? 'log',
    timestamp: microToMs(log.timestamp),
    attributes: jaegerTagsToRecord(log.fields),
  }));

  const parentRef = span.references?.find(
    (r) => r.refType === 'CHILD_OF' || r.refType === 'FOLLOWS_FROM',
  );

  const startMs = microToMs(span.startTime);
  const durationMs = microToMs(span.duration);

  const statusTag = (attributes['error'] as boolean | undefined) ? 'error' : 'unset';

  return {
    spanId: span.spanID,
    parentSpanId: parentRef?.spanID,
    name: span.operationName,
    startTime: startMs,
    endTime: startMs + durationMs,
    duration: durationMs,
    attributes,
    events,
    status: statusTag as 'ok' | 'error' | 'unset',
    children: [],
  };
}

export function parseJaeger(raw: unknown): ParsedTrace[] {
  let traces: JaegerTrace[] = [];

  if (Array.isArray(raw)) {
    // Could be array of traces directly or array of spans
    if (raw.length > 0 && 'spans' in (raw[0] as object)) {
      traces = raw as JaegerTrace[];
    } else {
      // Array of spans — synthesize one trace
      const spans = raw as JaegerSpan[];
      const traceId = spans[0]?.traceID ?? 'unknown';
      traces = [{ traceID: traceId, spans }];
    }
  } else if (raw && typeof raw === 'object') {
    const obj = raw as JaegerResponse;
    if (Array.isArray(obj.data)) {
      traces = obj.data;
    } else if ('traceID' in obj) {
      traces = [obj as unknown as JaegerTrace];
    }
  }

  return traces.map((trace) => {
    const parsedSpans = trace.spans.map((s) => parseJaegerSpan(s, trace.processes));
    const serviceName =
      (parsedSpans[0]?.attributes['service.name'] as string | undefined) ?? 'unknown';
    return assembleTrace(trace.traceID, parsedSpans, serviceName);
  });
}

// ---------------------------------------------------------------------------
// OTLP parser
// ---------------------------------------------------------------------------

function parseOtlpSpan(span: OtlpSpan): ParsedSpan {
  const attributes = otlpAttrsToRecord(span.attributes);
  const events: SpanEvent[] = (span.events ?? []).map((ev) => ({
    name: ev.name ?? 'event',
    timestamp: nanosToMs(ev.timeUnixNano),
    attributes: otlpAttrsToRecord(ev.attributes),
  }));

  const startMs = nanosToMs(span.startTimeUnixNano);
  const endMs = nanosToMs(span.endTimeUnixNano);

  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId || undefined,
    name: span.name,
    startTime: startMs,
    endTime: endMs,
    duration: endMs - startMs,
    attributes,
    events,
    status: otlpStatusToState(span.status),
    children: [],
  };
}

export function parseOtlp(raw: unknown): ParsedTrace[] {
  const payload = raw as OtlpPayload;
  if (!Array.isArray(payload.resourceSpans)) return [];

  // Group spans by traceId
  const traceMap = new Map<string, { spans: ParsedSpan[]; serviceName: string }>();

  for (const rs of payload.resourceSpans) {
    const resourceAttrs = otlpAttrsToRecord(rs.resource?.attributes);
    const serviceName = (resourceAttrs['service.name'] as string | undefined) ?? 'unknown';

    const scopeSpansArr = rs.scopeSpans ?? rs.instrumentationLibrarySpans ?? [];
    for (const ss of scopeSpansArr) {
      for (const span of ss.spans ?? []) {
        const parsed = parseOtlpSpan(span);
        // Merge resource attributes into span attributes (lower priority)
        parsed.attributes = { ...resourceAttrs, ...parsed.attributes };

        if (!traceMap.has(span.traceId)) {
          traceMap.set(span.traceId, { spans: [], serviceName });
        }
        traceMap.get(span.traceId)!.spans.push(parsed);
      }
    }
  }

  const results: ParsedTrace[] = [];
  for (const [traceId, { spans, serviceName }] of traceMap) {
    results.push(assembleTrace(traceId, spans, serviceName));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Format detection and auto-parse
// ---------------------------------------------------------------------------

export type TraceFormat = 'jaeger' | 'otlp' | 'auto';

function detectFormat(raw: unknown): 'jaeger' | 'otlp' {
  if (raw && typeof raw === 'object') {
    // OTLP has resourceSpans at top level
    if ('resourceSpans' in (raw as object)) return 'otlp';
    // Jaeger has data array of traces with spans
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data) && obj.data.length > 0) {
      const first = obj.data[0];
      if (first && typeof first === 'object' && 'traceID' in first) return 'jaeger';
    }
    // Single Jaeger trace
    if ('traceID' in obj && 'spans' in obj) return 'jaeger';
    // Array of Jaeger spans
    if (Array.isArray(raw) && raw.length > 0) {
      const first = raw[0];
      if (first && typeof first === 'object' && 'spanID' in first) return 'jaeger';
      if (first && typeof first === 'object' && 'traceID' in first && 'spans' in first)
        return 'jaeger';
    }
  }
  // Default to OTLP
  return 'otlp';
}

export function parseTraces(raw: unknown, format: TraceFormat = 'auto'): ParsedTrace[] {
  const fmt = format === 'auto' ? detectFormat(raw) : format;
  if (fmt === 'jaeger') return parseJaeger(raw);
  return parseOtlp(raw);
}
