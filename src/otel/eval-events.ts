import { randomUUID } from 'node:crypto';
import type { EvaluatorResult, TestResult, RunResult } from '../core/types.js';
import { SERVICE_NAME } from '../core/constants.js';

/** OTel GenAI standard evaluation event */
export interface OtelEvalEvent {
  name: 'gen_ai.evaluation.result';
  timeUnixNano: string;
  attributes: Array<{ key: string; value: { stringValue?: string; doubleValue?: number; boolValue?: boolean } }>;
}

function toAttrValue(v: string | number | boolean): { stringValue?: string; doubleValue?: number; boolValue?: boolean } {
  if (typeof v === 'number') return { doubleValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  return { stringValue: v };
}

function makeAttr(key: string, value: string | number | boolean) {
  return { key, value: toAttrValue(value) };
}

/**
 * Convert an EvaluatorResult into an OTel-standard evaluation event.
 * Follows the gen_ai.evaluation.result schema from OpenTelemetry GenAI SIG.
 */
export function evaluatorResultToOtelEvent(
  result: EvaluatorResult,
  timestampMs: number,
): OtelEvalEvent {
  const scoreLabel = result.skipped ? 'skipped' : result.pass ? 'pass' : 'fail';
  const kind = result.metadata?.['kind'] as string | undefined;

  const attributes: OtelEvalEvent['attributes'] = [
    makeAttr('gen_ai.evaluation.name', result.evaluator),
    makeAttr('gen_ai.evaluation.score.value', result.score),
    makeAttr('gen_ai.evaluation.score.label', scoreLabel),
  ];

  if (result.explanation) {
    attributes.push(makeAttr('gen_ai.evaluation.explanation', result.explanation));
  }
  if (kind) {
    attributes.push(makeAttr('eval.evaluator.kind', kind));
  }

  return {
    name: 'gen_ai.evaluation.result',
    timeUnixNano: String(timestampMs * 1_000_000),
    attributes,
  };
}

/**
 * Build a complete set of OTel evaluation events for a test result.
 * Each evaluator result becomes one gen_ai.evaluation.result event.
 */
export function testResultToOtelEvents(test: TestResult): OtelEvalEvent[] {
  const nowMs = Date.now();
  return test.evaluatorResults.map((er) =>
    evaluatorResultToOtelEvent(er, nowMs),
  );
}

function makeId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

/**
 * Build OTel resource spans that embed evaluation results as events
 * on the original agent trace spans (by correlating trace IDs).
 * This is for POST back to ES so eval results appear inline.
 */
export function buildEvalEventSpans(
  result: RunResult,
  originalTraceId?: string,
): { resourceSpans: unknown[] } {
  const startMs = new Date(result.timestamp || Date.now()).getTime();
  const spans: unknown[] = [];
  let offset = 0;

  for (const suite of result.suites) {
    for (const test of suite.tests) {
      const traceId = originalTraceId ?? randomUUID().replace(/-/g, '');
      const spanId = makeId();
      const testStart = startMs + offset;
      const testEnd = testStart + test.latencyMs;

      const events = test.evaluatorResults.map((er) => {
        const scoreLabel = er.skipped ? 'skipped' : er.pass ? 'pass' : 'fail';
        const kind = er.metadata?.['kind'] as string | undefined;

        const eventAttrs: Array<{ key: string; value: { stringValue?: string; doubleValue?: number; boolValue?: boolean } }> = [
          { key: 'gen_ai.evaluation.name', value: { stringValue: er.evaluator } },
          { key: 'gen_ai.evaluation.score.value', value: { doubleValue: er.score } },
          { key: 'gen_ai.evaluation.score.label', value: { stringValue: scoreLabel } },
          { key: 'eval.run_id', value: { stringValue: result.runId } },
          { key: 'eval.test_name', value: { stringValue: test.name } },
        ];
        if (er.explanation) {
          eventAttrs.push({ key: 'gen_ai.evaluation.explanation', value: { stringValue: er.explanation } });
        }
        if (kind) {
          eventAttrs.push({ key: 'eval.evaluator.kind', value: { stringValue: kind } });
        }

        return {
          name: 'gen_ai.evaluation.result',
          timeUnixNano: String(testEnd * 1_000_000),
          attributes: eventAttrs,
        };
      });

      spans.push({
        traceId,
        spanId,
        parentSpanId: '',
        name: `eval-result:${test.name}`,
        startTimeUnixNano: String(testStart * 1_000_000),
        endTimeUnixNano: String(testEnd * 1_000_000),
        attributes: [
          { key: 'eval.run_id', value: { stringValue: result.runId } },
          { key: 'eval.test_name', value: { stringValue: test.name } },
          { key: 'eval.test.suite', value: { stringValue: test.suite } },
          { key: 'eval.test.pass', value: { boolValue: test.pass } },
          { key: 'eval.test.latency_ms', value: { doubleValue: test.latencyMs } },
        ],
        events,
      });

      offset += test.latencyMs;
    }
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: SERVICE_NAME } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: `${SERVICE_NAME}/eval-events` },
            spans,
          },
        ],
      },
    ],
  };
}

/**
 * Export evaluation events to Elasticsearch OTLP endpoint.
 * Creates spans with evaluation events attached, so they appear
 * in Kibana APM trace view alongside the original agent spans.
 */
export async function exportEvalEventsToElastic(
  result: RunResult,
  endpoint: string,
  options?: { apiKey?: string; originalTraceId?: string },
): Promise<void> {
  const payload = buildEvalEventSpans(result, options?.originalTraceId);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options?.apiKey) {
    headers['Authorization'] = `ApiKey ${options.apiKey}`;
  }

  const response = await fetch(`${endpoint}/v1/traces`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OTLP export failed: ${response.status} ${response.statusText} — ${body}`);
  }
}
