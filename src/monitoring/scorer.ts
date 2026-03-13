import type { TraceEvent } from './consumer.js';
import { createEvaluator } from '../evaluators/index.js';
import type { ToolCallRecord } from '../core/types.js';

export interface ScoredTrace {
  traceId: string;
  timestamp: number;
  scores: Record<string, number>;
  toolsCalled: string[];
  latencyMs: number;
  anomaly: boolean;
}

function extractToolCalls(spans: TraceEvent[]): ToolCallRecord[] {
  return spans
    .filter(
      (s) =>
        s.name.startsWith('tool_call') ||
        s.attributes['tool.name'] !== undefined ||
        s.attributes['mcp.tool'] !== undefined,
    )
    .map((s) => ({
      tool: String(s.attributes['tool.name'] ?? s.attributes['mcp.tool'] ?? s.name),
      args: (s.attributes['tool.args'] as Record<string, unknown>) ?? {},
      result: {
        content: [{ type: 'text', text: String(s.attributes['tool.result'] ?? '') }],
        isError: s.attributes['error'] === true,
      },
      latencyMs: s.endTime - s.startTime,
    }));
}

export async function scoreTrace(
  trace: TraceEvent[],
  evaluatorNames: string[],
): Promise<ScoredTrace> {
  if (trace.length === 0) {
    return {
      traceId: '',
      timestamp: Date.now(),
      scores: {},
      toolsCalled: [],
      latencyMs: 0,
      anomaly: false,
    };
  }

  const traceId = trace[0].traceId;
  const toolCalls = extractToolCalls(trace);
  const toolsCalled = [...new Set(toolCalls.map((tc) => tc.tool))];

  const minStart = Math.min(...trace.map((s) => s.startTime));
  const maxEnd = Math.max(...trace.map((s) => s.endTime));
  const latencyMs = maxEnd - minStart;

  const scores: Record<string, number> = {};

  for (const name of evaluatorNames) {
    try {
      const evaluator = createEvaluator(name);
      const result = await evaluator.evaluate({
        testName: `monitoring:${traceId}`,
        toolCalls,
      });
      scores[name] = result.score;
    } catch {
      // evaluator not available or failed — skip
    }
  }

  return {
    traceId,
    timestamp: minStart,
    scores,
    toolsCalled,
    latencyMs,
    anomaly: false,
  };
}
