import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateVariants } from './variants.js';

vi.mock('../evaluators/llm-judge.js', () => ({
  callJudge: vi.fn(),
}));

import { callJudge } from '../evaluators/llm-judge.js';

const mockedCallJudge = vi.mocked(callJudge);

describe('generateVariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when count is 0', async () => {
    const result = await generateVariants('test prompt', 0);
    expect(result).toEqual([]);
    expect(mockedCallJudge).not.toHaveBeenCalled();
  });

  it('returns empty array when count is negative', async () => {
    const result = await generateVariants('test prompt', -1);
    expect(result).toEqual([]);
  });

  it('parses JSON array from judge response explanation', async () => {
    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '["What tools exist?", "Show available tools", "List the tools"]',
    });

    const result = await generateVariants('List all tools', 3);
    expect(result).toEqual(['What tools exist?', 'Show available tools', 'List the tools']);
  });

  it('limits results to requested count', async () => {
    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '["variant 1", "variant 2", "variant 3", "variant 4", "variant 5"]',
    });

    const result = await generateVariants('test', 2);
    expect(result).toHaveLength(2);
  });

  it('falls back to line splitting when JSON parse fails', async () => {
    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '1. What tools exist?\n2. Show me the tools\n3. Which tools are available?',
    });

    const result = await generateVariants('List tools', 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('What tools exist?');
    expect(result[1]).toBe('Show me the tools');
    expect(result[2]).toBe('Which tools are available?');
  });

  it('passes prompt to callJudge in userPrompt', async () => {
    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '["rephrased"]',
    });

    await generateVariants('my test prompt', 1);
    expect(mockedCallJudge).toHaveBeenCalledTimes(1);
    const call = mockedCallJudge.mock.calls[0][0];
    expect(call.userPrompt).toContain('my test prompt');
    expect(call.userPrompt).toContain('1');
    expect(call.systemPrompt).toContain('rephras');
  });

  it('handles embedded JSON array in text', async () => {
    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: 'Here are the variants:\n["variant A", "variant B"]',
    });

    const result = await generateVariants('test', 2);
    expect(result).toEqual(['variant A', 'variant B']);
  });

  it('strips quotes from fallback lines', async () => {
    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '"First rephrasing"\n"Second rephrasing"',
    });

    const result = await generateVariants('test', 2);
    expect(result[0]).toBe('First rephrasing');
    expect(result[1]).toBe('Second rephrasing');
  });
});
