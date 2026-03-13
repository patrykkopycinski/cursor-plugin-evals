import type { TestResult, EvaluatorResult, ToolCallRecord } from '../core/types.js';

export interface TraceViewData {
  runId: string;
  testName: string;
  suiteName: string;
  model?: string;
  turns: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCalls?: Array<{
      tool: string;
      args: Record<string, unknown>;
      result?: string;
      latencyMs?: number;
    }>;
  }>;
  evaluatorResults: Array<{
    name: string;
    score: number;
    pass: boolean;
    explanation: string;
  }>;
  tokenUsage?: { input: number; output: number };
  totalLatencyMs: number;
}

function toolCallsToTurns(toolCalls: ToolCallRecord[]): TraceViewData['turns'] {
  const turns: TraceViewData['turns'] = [];

  for (const tc of toolCalls) {
    const resultText = tc.result.content
      .map((c) => c.text ?? '')
      .filter(Boolean)
      .join('\n');

    turns.push({
      role: 'tool',
      content: resultText || '(no output)',
      toolCalls: [
        {
          tool: tc.tool,
          args: tc.args,
          result: resultText || undefined,
          latencyMs: tc.latencyMs,
        },
      ],
    });
  }

  return turns;
}

function mapEvaluatorResults(results: EvaluatorResult[]): TraceViewData['evaluatorResults'] {
  return results.map((r) => ({
    name: r.evaluator,
    score: r.score,
    pass: r.pass,
    explanation: r.explanation ?? '',
  }));
}

export function extractTraceViewData(testResult: TestResult, runId: string): TraceViewData {
  const metadata = testResult.metadata as Record<string, unknown> | undefined;
  const messages = (metadata?.messages ?? []) as Array<{
    role: string;
    content: string;
  }>;

  const turns: TraceViewData['turns'] =
    messages.length > 0
      ? messages.map((m) => ({
          role: m.role as TraceViewData['turns'][number]['role'],
          content: m.content,
        }))
      : [
          { role: 'user' as const, content: (metadata?.prompt as string) ?? testResult.name },
          ...toolCallsToTurns(testResult.toolCalls),
        ];

  return {
    runId,
    testName: testResult.name,
    suiteName: testResult.suite,
    model: testResult.model,
    turns,
    evaluatorResults: mapEvaluatorResults(testResult.evaluatorResults),
    tokenUsage: testResult.tokenUsage
      ? { input: testResult.tokenUsage.input, output: testResult.tokenUsage.output }
      : undefined,
    totalLatencyMs: testResult.latencyMs,
  };
}
