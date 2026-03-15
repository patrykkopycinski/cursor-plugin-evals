import { ToolSelectionEvaluator } from './tool-selection.js';
import type { EvaluatorContext, ToolCallRecord } from '../core/types.js';

const evaluator = new ToolSelectionEvaluator();

function makeToolCall(tool: string): ToolCallRecord {
  return {
    tool,
    args: {},
    result: { content: [{ type: 'text', text: '' }] },
    latencyMs: 0,
  };
}

function makeContext(
  expectedTools: string[] | undefined,
  actualToolCalls: ToolCallRecord[],
  threshold?: number,
): EvaluatorContext {
  return {
    testName: 'test',
    toolCalls: actualToolCalls,
    expected: expectedTools ? { tools: expectedTools } : undefined,
    config: threshold !== undefined ? { threshold } : undefined,
  };
}

describe('ToolSelectionEvaluator', () => {
  it('scores 1.0 on perfect match', async () => {
    const ctx = makeContext(['tool_a', 'tool_b'], [makeToolCall('tool_a'), makeToolCall('tool_b')]);
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('scores 0.0 when no tools match', async () => {
    const ctx = makeContext(['tool_a', 'tool_b'], [makeToolCall('tool_x'), makeToolCall('tool_y')]);
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
  });

  it('computes correct F-beta for partial match', async () => {
    const ctx = makeContext(
      ['tool_a', 'tool_b'],
      [makeToolCall('tool_a'), makeToolCall('tool_c')],
      0,
    );
    const result = await evaluator.evaluate(ctx);

    const precision = 1 / 2;
    const recall = 1 / 2;
    const expectedFbeta = (1 + 4) * precision * recall / (4 * precision + recall);

    expect(result.score).toBeCloseTo(expectedFbeta, 3);
  });

  it('reduces precision when extra tools are present', async () => {
    const ctx = makeContext(
      ['tool_a'],
      [makeToolCall('tool_a'), makeToolCall('tool_b'), makeToolCall('tool_c')],
      0,
    );
    const result = await evaluator.evaluate(ctx);

    const precision = 1 / 3;
    const recall = 1 / 1;
    const expectedFbeta = (1 + 4) * precision * recall / (4 * precision + recall);

    expect(result.score).toBeCloseTo(expectedFbeta, 3);
    expect(result.metadata?.precision).toBeCloseTo(precision, 3);
    expect(result.metadata?.recall).toBe(1.0);
  });

  it('reduces recall when expected tools are missing', async () => {
    const ctx = makeContext(['tool_a', 'tool_b', 'tool_c'], [makeToolCall('tool_a')], 0);
    const result = await evaluator.evaluate(ctx);

    const precision = 1 / 1;
    const recall = 1 / 3;
    const expectedFbeta = (1 + 4) * precision * recall / (4 * precision + recall);

    expect(result.score).toBeCloseTo(expectedFbeta, 3);
    expect(result.metadata?.precision).toBe(1.0);
    expect(result.metadata?.recall).toBeCloseTo(recall, 3);
  });

  it('scores 1.0 when expected tools is empty', async () => {
    const ctx = makeContext([], [makeToolCall('tool_a')]);
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('skip');
  });

  it('scores 0.0 when actual tools is empty but expected has entries', async () => {
    const ctx = makeContext(['tool_a', 'tool_b'], []);
    const result = await evaluator.evaluate(ctx);
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
  });
});
