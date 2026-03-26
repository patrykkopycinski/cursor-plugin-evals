import { randomUUID } from 'crypto';
import type { RunResult } from '../core/types.js';

export interface OtelSpanEvent {
  name: string;
  attributes?: Record<string, unknown>;
  timestamp?: number;
}

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime: number;
  attributes: Record<string, unknown>;
  events?: OtelSpanEvent[];
}

function makeId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

export function buildOtelSpans(result: RunResult): OtelSpan[] {
  const traceId = randomUUID().replace(/-/g, '');
  const startMs = new Date(result.timestamp || Date.now()).getTime();
  const spans: OtelSpan[] = [];

  const rootSpanId = makeId();
  spans.push({
    traceId, spanId: rootSpanId, name: 'eval-run',
    startTime: startMs, endTime: startMs + result.overall.duration,
    attributes: {
      'eval.run_id': result.runId, 'eval.config': result.config,
      'eval.pass_rate': result.overall.passRate, 'eval.total': result.overall.total,
      'eval.passed': result.overall.passed, 'eval.failed': result.overall.failed,
      'eval.duration_ms': result.overall.duration,
    },
  });

  let offset = 0;
  for (const suite of result.suites) {
    for (const test of suite.tests) {
      const testSpanId = makeId();
      const testStart = startMs + offset;
      const testEnd = testStart + test.latencyMs;

      const events: OtelSpanEvent[] = test.evaluatorResults.map(er => ({
        name: `evaluator:${er.evaluator}`,
        attributes: { score: er.score, pass: er.pass, label: er.label },
        timestamp: testEnd,
      }));

      spans.push({
        traceId, spanId: testSpanId, parentSpanId: rootSpanId,
        name: `eval-test:${test.name}`,
        startTime: testStart, endTime: testEnd,
        attributes: {
          'eval.test.name': test.name, 'eval.test.suite': test.suite,
          'eval.test.layer': test.layer, 'eval.test.pass': test.pass,
          'eval.test.latency_ms': test.latencyMs, 'eval.test.model': test.model ?? '',
        },
        events,
      });

      for (const tc of test.toolCalls) {
        spans.push({
          traceId, spanId: makeId(), parentSpanId: testSpanId,
          name: `tool:${tc.tool}`,
          startTime: testStart, endTime: testStart + tc.latencyMs,
          attributes: { 'tool.name': tc.tool, 'tool.latency_ms': tc.latencyMs, 'tool.is_error': tc.result.isError ?? false },
        });
      }
      offset += test.latencyMs;
    }
  }
  return spans;
}

export async function exportToElastic(spans: OtelSpan[], endpoint: string): Promise<void> {
  const resourceSpans = [{
    resource: { attributes: [{ key: 'service.name', value: { stringValue: 'cursor-plugin-evals' } }] },
    scopeSpans: [{
      scope: { name: 'cursor-plugin-evals' },
      spans: spans.map(s => ({
        traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId ?? '',
        name: s.name,
        startTimeUnixNano: String(s.startTime * 1_000_000),
        endTimeUnixNano: String(s.endTime * 1_000_000),
        attributes: Object.entries(s.attributes).map(([k, v]) => ({
          key: k,
          value: typeof v === 'number' ? { doubleValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) },
        })),
        events: s.events?.map(e => ({
          name: e.name,
          timeUnixNano: String((e.timestamp ?? s.endTime) * 1_000_000),
          attributes: Object.entries(e.attributes ?? {}).map(([k, v]) => ({
            key: k,
            value: typeof v === 'number' ? { doubleValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) },
          })),
        })),
      })),
    }],
  }];
  await fetch(`${endpoint}/v1/traces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resourceSpans }) });
}
