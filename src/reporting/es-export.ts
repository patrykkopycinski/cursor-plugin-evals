import type { RunResult, TestResult } from '../core/types.js';

interface EvalScoreDocument {
  '@timestamp': string;
  run_id: string;
  experiment_id: string;
  test_name: string;
  tool_calls: Array<{ tool: string; latency_ms: number }>;
  evaluator_results: Array<{
    evaluator: string;
    score: number;
    pass: boolean;
    label?: string;
    explanation?: string;
  }>;
  model?: string;
  latency_ms: number;
  token_usage?: { input: number; output: number; cached?: number };
  adapter: 'mcp-plugin';
}

function testToDocument(
  test: TestResult,
  runId: string,
  timestamp: string,
  config: string,
): EvalScoreDocument {
  return {
    '@timestamp': timestamp,
    run_id: runId,
    experiment_id: `${config}/${test.suite}`,
    test_name: test.name,
    tool_calls: test.toolCalls.map((tc) => ({
      tool: tc.tool,
      latency_ms: tc.latencyMs,
    })),
    evaluator_results: test.evaluatorResults.map((ev) => ({
      evaluator: ev.evaluator,
      score: ev.score,
      pass: ev.pass,
      ...(ev.label ? { label: ev.label } : {}),
      ...(ev.explanation ? { explanation: ev.explanation } : {}),
    })),
    model: test.model,
    latency_ms: test.latencyMs,
    token_usage: test.tokenUsage
      ? {
          input: test.tokenUsage.input,
          output: test.tokenUsage.output,
          ...(test.tokenUsage.cached !== undefined ? { cached: test.tokenUsage.cached } : {}),
        }
      : undefined,
    adapter: 'mcp-plugin',
  };
}

export async function exportToEsDatastream(
  result: RunResult,
  esUrl: string,
  apiKey?: string,
): Promise<void> {
  const tests = result.suites.flatMap((s) => s.tests);
  if (tests.length === 0) return;

  const docs = tests.map((t) => testToDocument(t, result.runId, result.timestamp, result.config));

  const index = 'kibana-evaluations';
  const bulkLines: string[] = [];
  for (const doc of docs) {
    bulkLines.push(JSON.stringify({ create: { _index: index } }));
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
    throw new Error(`ES datastream bulk index failed (${res.status}): ${resBody}`);
  }

  const bulkResult = (await res.json()) as {
    errors?: boolean;
    items?: Array<Record<string, { error?: unknown }>>;
  };
  if (bulkResult.errors) {
    const firstError = bulkResult.items?.find((item) => {
      const op = Object.values(item)[0];
      return op?.error;
    });
    const errorDetail = firstError
      ? JSON.stringify(Object.values(firstError)[0]?.error)
      : 'unknown';
    throw new Error(`ES datastream bulk index had errors: ${errorDetail}`);
  }
}
