import { describe, it, expect } from 'vitest';
import { McpProtocolEvaluator } from './mcp-protocol.js';
import type { EvaluatorContext, ToolCallRecord } from '../core/types.js';

const makeCall = (overrides: Partial<ToolCallRecord> = {}): ToolCallRecord => ({
  tool: 'valid_tool',
  args: { key: 'value' },
  result: { content: [{ type: 'text', text: 'ok' }] },
  latencyMs: 50,
  ...overrides,
});

const makeCtx = (overrides: Partial<EvaluatorContext> = {}): EvaluatorContext => ({
  testName: 'mcp-protocol-test',
  toolCalls: [],
  ...overrides,
});

describe('McpProtocolEvaluator', () => {
  const evaluator = new McpProtocolEvaluator();

  it('has correct name', () => {
    expect(evaluator.name).toBe('mcp-protocol');
  });

  // --- Empty tool calls ---

  it('skips with score 1.0 when no tool calls', async () => {
    const result = await evaluator.evaluate(makeCtx({ toolCalls: [] }));
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('skip');
  });

  // --- Valid tool calls ---

  it('passes for a valid tool call with name, args, and result', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall()],
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
    expect(result.label).toBe('pass');
  });

  it('passes for valid tool call without result (result is optional)', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({ result: undefined as unknown as ToolCallRecord['result'] }),
        ],
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('passes for tool names with dots, dashes, slashes, and underscores', async () => {
    const validNames = [
      'my_tool',
      'my-tool',
      'my.tool',
      'namespace/tool',
      'a123',
      'Tool_Name-v2.1/sub',
    ];
    for (const name of validNames) {
      const result = await evaluator.evaluate(
        makeCtx({ toolCalls: [makeCall({ tool: name })] }),
      );
      expect(result.score).toBe(1.0);
    }
  });

  // --- Missing tool name ---

  it('fails when tool name is empty string', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall({ tool: '' })],
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toContain('Missing or non-string tool name');
  });

  // --- Invalid tool name characters ---

  it('fails when tool name starts with a number', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall({ tool: '123tool' })],
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toContain('Invalid tool name format');
  });

  it('fails when tool name contains spaces', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall({ tool: 'my tool' })],
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
  });

  it('fails when tool name contains special characters', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall({ tool: 'tool@name!' })],
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
  });

  // --- Invalid args ---

  it('fails when args is null', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({ args: null as unknown as Record<string, unknown> }),
        ],
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toContain('null or undefined');
  });

  it('fails when args is an array instead of object', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({ args: [1, 2, 3] as unknown as Record<string, unknown> }),
        ],
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toContain('array');
  });

  it('passes with empty args object', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [makeCall({ args: {} })],
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  // --- Missing result content ---

  it('fails when result content is not an array', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({
            result: { content: 'not an array' as unknown as Array<{ type: string }> },
          }),
        ],
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toContain('not an array');
  });

  it('fails when result content item missing type field', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({
            result: {
              content: [{ text: 'no type' } as unknown as { type: string }],
            },
          }),
        ],
      }),
    );
    expect(result.score).toBe(0.0);
    expect(result.pass).toBe(false);
    expect(result.explanation).toContain('missing valid type field');
  });

  // --- Multiple tool calls with mix of valid/invalid ---

  it('scores proportionally with mix of valid and invalid calls', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({ tool: 'valid_tool' }),
          makeCall({ tool: '' }),
        ],
      }),
    );
    expect(result.score).toBe(0.5);
    expect(result.pass).toBe(false);
  });

  it('passes when all multiple calls are valid', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({ tool: 'tool_a' }),
          makeCall({ tool: 'tool_b' }),
          makeCall({ tool: 'tool_c' }),
        ],
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  it('handles single invalid among many valid', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({ tool: 'a' }),
          makeCall({ tool: 'b' }),
          makeCall({ tool: '!invalid' }),
        ],
      }),
    );
    expect(result.score).toBeCloseTo(0.667, 2);
    expect(result.pass).toBe(false);
  });

  // --- Score rounding ---

  it('rounds score to 3 decimal places', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({ tool: 'a' }),
          makeCall({ tool: 'b' }),
          makeCall({ tool: '!bad' }),
        ],
      }),
    );
    expect(result.score).toBe(0.667);
  });

  // --- Metadata structure ---

  it('includes detailed metadata', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({ tool: 'good' }),
          makeCall({ tool: '' }),
        ],
      }),
    );
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.total).toBe(2);
    expect(meta.valid).toBe(1);
    expect(meta.invalid).toBe(1);
    const details = meta.details as Array<{ tool: string; valid: boolean; issues: string[] }>;
    expect(details).toHaveLength(2);
    expect(details[0].valid).toBe(true);
    expect(details[1].valid).toBe(false);
  });

  // --- isError on result does NOT cause failure (post-fix) ---

  it('passes when result has isError=true (not a protocol violation)', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({
            result: {
              content: [{ type: 'text', text: 'error message' }],
              isError: true,
            },
          }),
        ],
      }),
    );
    expect(result.score).toBe(1.0);
    expect(result.pass).toBe(true);
  });

  // --- Multiple issues on a single call ---

  it('reports multiple issues for a single malformed call', async () => {
    const result = await evaluator.evaluate(
      makeCtx({
        toolCalls: [
          makeCall({
            tool: '',
            args: null as unknown as Record<string, unknown>,
          }),
        ],
      }),
    );
    expect(result.score).toBe(0.0);
    const meta = result.metadata as Record<string, unknown>;
    const details = meta.details as Array<{ issues: string[] }>;
    expect(details[0].issues.length).toBeGreaterThanOrEqual(2);
  });
});
