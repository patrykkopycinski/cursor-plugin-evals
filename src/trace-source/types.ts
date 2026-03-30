export interface SpanEvent {
  name: string;
  timestamp: number; // ms
  attributes: Record<string, unknown>;
}

export interface ParsedSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number; // ms
  endTime: number; // ms
  duration: number; // ms
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  status: 'ok' | 'error' | 'unset';
  children: ParsedSpan[];
}

export interface ParsedTrace {
  traceId: string;
  spans: ParsedSpan[];
  rootSpan: ParsedSpan | null;
  serviceName: string;
  startTime: number; // ms
  endTime: number; // ms
  duration: number; // ms
}

export interface TraceSourceConfig {
  type: 'file' | 'elasticsearch';
  // file-specific
  path?: string;   // file path or glob pattern
  format?: 'jaeger' | 'otlp' | 'auto';
  // elasticsearch-specific
  endpoint?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  index?: string;  // default: 'traces-apm*,traces-generic.otel-*'
  serviceName?: string;
  timeRange?: { from: string; to: string };
  /** Document format hint: 'apm' (ECS), 'otlp' (OTel-native), or 'auto' (try both) */
  docFormat?: 'apm' | 'otlp' | 'auto';
}

export interface TraceSource {
  name: string;
  getTrace(traceId: string): Promise<ParsedTrace | null>;
  listTraces(options?: {
    limit?: number;
    serviceName?: string;
    timeRange?: { from: string; to: string };
  }): Promise<ParsedTrace[]>;
}
