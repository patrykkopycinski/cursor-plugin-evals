export interface ParsedSpan {
  name: string;
  attributes: Record<string, unknown>;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  parentPrompt?: string;
}

export interface ParsedTrace {
  traceId: string;
  spans: ParsedSpan[];
}

interface OtelAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string | number;
    doubleValue?: number;
    boolValue?: boolean;
    arrayValue?: { values: Array<{ stringValue?: string }> };
  };
}

interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  attributes?: OtelAttribute[];
  status?: { code?: number; message?: string };
}

interface OtelScopeSpans {
  scope?: { name?: string };
  spans: OtelSpan[];
}

interface OtelResourceSpans {
  resource?: { attributes?: OtelAttribute[] };
  scopeSpans: OtelScopeSpans[];
}

interface OtelExportRoot {
  resourceSpans: OtelResourceSpans[];
}

function extractAttributeValue(attr: OtelAttribute): unknown {
  const v = attr.value;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined)
    return typeof v.intValue === 'string' ? parseInt(v.intValue, 10) : v.intValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.arrayValue) return v.arrayValue.values.map((item) => item.stringValue ?? '');
  return undefined;
}

function attributesToMap(attrs?: OtelAttribute[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  if (!attrs) return map;
  for (const attr of attrs) {
    map[attr.key] = extractAttributeValue(attr);
  }
  return map;
}

function tryParseJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
  } catch (_e) {
    // not JSON
  }
  return undefined;
}

function parseSingleSpan(span: OtelSpan): ParsedSpan {
  const attributes = attributesToMap(span.attributes);

  const toolName =
    (attributes['tool.name'] as string | undefined) ??
    (attributes['gen_ai.tool.name'] as string | undefined) ??
    (attributes['mcp.tool.name'] as string | undefined);

  const rawArgs =
    attributes['tool.args'] ?? attributes['gen_ai.tool.args'] ?? attributes['mcp.tool.args'];
  const toolArgs =
    tryParseJson(rawArgs) ??
    (typeof rawArgs === 'object' && rawArgs !== null
      ? (rawArgs as Record<string, unknown>)
      : undefined);

  const rawResult =
    attributes['tool.result'] ?? attributes['gen_ai.tool.result'] ?? attributes['mcp.tool.result'];
  const toolResult =
    typeof rawResult === 'string'
      ? rawResult
      : rawResult !== undefined
        ? JSON.stringify(rawResult)
        : undefined;

  const parentPrompt =
    (attributes['gen_ai.prompt'] as string | undefined) ??
    (attributes['user.prompt'] as string | undefined);

  return {
    name: span.name,
    attributes,
    toolName,
    toolArgs,
    toolResult,
    parentPrompt,
  };
}

export function parseOtelTrace(json: unknown): ParsedTrace {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid OTel trace: expected an object');
  }

  const root = json as OtelExportRoot;
  if (!root.resourceSpans || !Array.isArray(root.resourceSpans)) {
    throw new Error('Invalid OTel trace: missing resourceSpans array');
  }

  const spans: ParsedSpan[] = [];
  let traceId = '';

  for (const rs of root.resourceSpans) {
    if (!rs.scopeSpans) continue;
    for (const ss of rs.scopeSpans) {
      if (!ss.spans) continue;
      for (const span of ss.spans) {
        if (!traceId && span.traceId) {
          traceId = span.traceId;
        }
        spans.push(parseSingleSpan(span));
      }
    }
  }

  if (!traceId) {
    traceId = 'unknown';
  }

  return { traceId, spans };
}
