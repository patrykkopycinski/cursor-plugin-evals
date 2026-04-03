import * as readline from 'node:readline';

export interface TraceEvent {
  traceId: string;
  spanId: string;
  name: string;
  attributes: Record<string, unknown>;
  startTime: number;
  endTime: number;
  parentSpanId?: string;
}

export function parseOtelJsonLine(line: string): TraceEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const raw = JSON.parse(trimmed);

    const traceId = raw.traceId ?? raw.trace_id ?? raw.traceID;
    const spanId = raw.spanId ?? raw.span_id ?? raw.spanID;
    const name = raw.name ?? '';
    const attributes = raw.attributes ?? {};
    const startTime =
      typeof raw.startTime === 'number'
        ? raw.startTime
        : typeof raw.startTimeUnixNano === 'string'
          ? Number(raw.startTimeUnixNano) / 1e6
          : Date.now();
    const endTime =
      typeof raw.endTime === 'number'
        ? raw.endTime
        : typeof raw.endTimeUnixNano === 'string'
          ? Number(raw.endTimeUnixNano) / 1e6
          : startTime;
    const parentSpanId = raw.parentSpanId ?? raw.parent_span_id ?? undefined;

    if (!traceId || !spanId) return null;

    return { traceId, spanId, name, attributes, startTime, endTime, parentSpanId };
  } catch (_e) {
    return null;
  }
}

export async function* consumeStdin(): AsyncGenerator<TraceEvent> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const event = parseOtelJsonLine(line);
    if (event) yield event;
  }
}
