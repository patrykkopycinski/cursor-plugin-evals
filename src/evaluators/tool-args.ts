import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}

function valueMatches(expected: unknown, actual: unknown): boolean {
  if (deepEqual(expected, actual)) return true;

  if (typeof expected === 'string' && typeof actual === 'string') {
    return actual.toLowerCase().includes(expected.toLowerCase());
  }

  return false;
}

export class ToolArgsEvaluator implements Evaluator {
  readonly name = 'tool-args';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const threshold =
      (context.config?.['threshold'] as number | undefined) ?? 0.7;
    const expectedToolArgs = context.expected?.toolArgs;

    if (!expectedToolArgs || Object.keys(expectedToolArgs).length === 0) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'skip',
        explanation: 'No expected tool arguments specified; skipping evaluation.',
      };
    }

    let totalExpected = 0;
    let totalMatched = 0;
    const details: Array<{
      tool: string;
      arg: string;
      expected: unknown;
      actual: unknown;
      match: boolean;
    }> = [];

    for (const [toolName, expectedArgs] of Object.entries(expectedToolArgs)) {
      const toolCall = context.toolCalls.find(
        (tc) =>
          tc.tool === toolName ||
          tc.tool.toLowerCase() === toolName.toLowerCase()
      );

      for (const [argName, expectedValue] of Object.entries(expectedArgs)) {
        totalExpected++;

        if (!toolCall) {
          details.push({
            tool: toolName,
            arg: argName,
            expected: expectedValue,
            actual: undefined,
            match: false,
          });
          continue;
        }

        const actualValue = toolCall.args[argName];
        const match = valueMatches(expectedValue, actualValue);

        if (match) totalMatched++;

        details.push({
          tool: toolName,
          arg: argName,
          expected: expectedValue,
          actual: actualValue,
          match,
        });
      }
    }

    const score =
      totalExpected > 0
        ? Math.round((totalMatched / totalExpected) * 1000) / 1000
        : 1.0;

    const mismatches = details.filter((d) => !d.match);

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= threshold ? 'pass' : 'fail',
      explanation:
        `Matched ${totalMatched}/${totalExpected} expected arguments (score=${score.toFixed(3)}).` +
        (mismatches.length > 0
          ? ` Mismatches: ${mismatches.map((m) => `${m.tool}.${m.arg}`).join(', ')}.`
          : ''),
      metadata: {
        totalExpected,
        totalMatched,
        threshold,
        details,
      },
    };
  }
}
