import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePromptVariants, optimizePrompt } from './optimizer.js';
import { formatOptimizationReport } from './report.js';

vi.mock('../evaluators/llm-judge.js', () => ({
  callJudge: vi.fn(),
}));

vi.mock('../core/runner.js', () => ({
  runEvaluation: vi.fn(),
}));

vi.mock('../core/config.js', () => ({
  loadConfig: vi.fn(),
}));

import { callJudge } from '../evaluators/llm-judge.js';
import { runEvaluation } from '../core/runner.js';
import type { EvalConfig, RunResult, SuiteConfig } from '../core/types.js';

const mockedCallJudge = vi.mocked(callJudge);
const mockedRunEvaluation = vi.mocked(runEvaluation);

function makeRunResult(evaluatorScores: Record<string, number>): RunResult {
  return {
    runId: 'test-run',
    timestamp: new Date().toISOString(),
    config: 'test',
    suites: [
      {
        name: 'test-suite',
        layer: 'llm',
        tests: [
          {
            name: 'test-1',
            suite: 'test-suite',
            layer: 'llm',
            pass: true,
            toolCalls: [],
            evaluatorResults: Object.entries(evaluatorScores).map(([evaluator, score]) => ({
              evaluator,
              score,
              pass: score >= 0.5,
            })),
            latencyMs: 100,
          },
        ],
        passRate: 1,
        duration: 100,
        evaluatorSummary: {},
      },
    ],
    overall: { total: 1, passed: 1, failed: 0, skipped: 0, passRate: 1, duration: 100 },
  };
}

function makeLlmConfig(): EvalConfig {
  return {
    plugin: { name: 'test-plugin' },
    suites: [
      {
        name: 'test-suite',
        layer: 'llm',
        tests: [
          {
            name: 'test-1',
            prompt: 'Do something',
            system: 'You are a helpful assistant.',
            evaluators: ['tool_selection'],
            expected: { tools: ['search'] },
          },
        ],
      } as SuiteConfig,
    ],
  };
}

describe('generatePromptVariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when count is 0', async () => {
    const result = await generatePromptVariants('test', 0.5, 0);
    expect(result).toEqual([]);
    expect(mockedCallJudge).not.toHaveBeenCalled();
  });

  it('parses JSON array from judge response', async () => {
    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '["variant A", "variant B", "variant C"]',
    });

    const result = await generatePromptVariants('original prompt', 0.6, 3);
    expect(result).toEqual(['variant A', 'variant B', 'variant C']);
  });

  it('limits results to requested count', async () => {
    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '["v1", "v2", "v3", "v4", "v5"]',
    });

    const result = await generatePromptVariants('test', 0.5, 2);
    expect(result).toHaveLength(2);
  });

  it('falls back to line splitting on invalid JSON', async () => {
    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '1. First variant\n2. Second variant\n3. Third variant',
    });

    const result = await generatePromptVariants('test', 0.5, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('First variant');
  });

  it('includes current score in the judge request', async () => {
    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '["better version"]',
    });

    await generatePromptVariants('my prompt', 0.73, 1);
    expect(mockedCallJudge).toHaveBeenCalledTimes(1);
    const call = mockedCallJudge.mock.calls[0][0];
    expect(call.userPrompt).toContain('0.730');
    expect(call.userPrompt).toContain('my prompt');
  });
});

describe('optimizePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when suite not found', async () => {
    const config = makeLlmConfig();
    await expect(
      optimizePrompt(config, { suite: 'nonexistent', targetEvaluator: 'tool_selection' }),
    ).rejects.toThrow('Suite "nonexistent" not found');
  });

  it('throws for non-llm suites', async () => {
    const config = makeLlmConfig();
    config.suites[0].layer = 'static';
    await expect(
      optimizePrompt(config, { suite: 'test-suite', targetEvaluator: 'tool_selection' }),
    ).rejects.toThrow('only works on llm-layer');
  });

  it('stops early when targetScore is reached', async () => {
    const config = makeLlmConfig();

    mockedRunEvaluation
      .mockResolvedValueOnce(makeRunResult({ tool_selection: 0.6 }))
      .mockResolvedValueOnce(makeRunResult({ tool_selection: 0.98 }));

    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '["improved prompt"]',
    });

    const result = await optimizePrompt(config, {
      suite: 'test-suite',
      targetEvaluator: 'tool_selection',
      maxIterations: 5,
      variantsPerIteration: 1,
      targetScore: 0.95,
    });

    expect(result.optimizedScore).toBe(0.98);
    expect(result.iterations).toBe(1);
    expect(result.improvement).toBeCloseTo(0.38);
  });

  it('performs hill-climbing across iterations', async () => {
    const config = makeLlmConfig();

    mockedRunEvaluation
      .mockResolvedValueOnce(makeRunResult({ tool_selection: 0.4 }))
      .mockResolvedValueOnce(makeRunResult({ tool_selection: 0.5 }))
      .mockResolvedValueOnce(makeRunResult({ tool_selection: 0.45 }))
      .mockResolvedValueOnce(makeRunResult({ tool_selection: 0.7 }))
      .mockResolvedValueOnce(makeRunResult({ tool_selection: 0.65 }));

    mockedCallJudge
      .mockResolvedValueOnce({
        score: 1,
        label: 'OK',
        explanation: '["iter1-v1", "iter1-v2"]',
      })
      .mockResolvedValueOnce({
        score: 1,
        label: 'OK',
        explanation: '["iter2-v1", "iter2-v2"]',
      });

    const result = await optimizePrompt(config, {
      suite: 'test-suite',
      targetEvaluator: 'tool_selection',
      maxIterations: 2,
      variantsPerIteration: 2,
    });

    expect(result.originalScore).toBe(0.4);
    expect(result.optimizedScore).toBe(0.7);
    expect(result.history.length).toBeGreaterThan(1);
    expect(result.history[0]).toEqual({
      iteration: 0,
      prompt: 'You are a helpful assistant.',
      score: 0.4,
    });
  });

  it('returns original when no improvement found', async () => {
    const config = makeLlmConfig();

    mockedRunEvaluation
      .mockResolvedValueOnce(makeRunResult({ tool_selection: 0.8 }))
      .mockResolvedValueOnce(makeRunResult({ tool_selection: 0.6 }));

    mockedCallJudge.mockResolvedValue({
      score: 1,
      label: 'OK',
      explanation: '["worse prompt"]',
    });

    const result = await optimizePrompt(config, {
      suite: 'test-suite',
      targetEvaluator: 'tool_selection',
      maxIterations: 1,
      variantsPerIteration: 1,
    });

    expect(result.optimizedPrompt).toBe('You are a helpful assistant.');
    expect(result.optimizedScore).toBe(0.8);
    expect(result.improvement).toBe(0);
  });
});

describe('formatOptimizationReport', () => {
  it('renders a markdown report with all sections', () => {
    const report = formatOptimizationReport({
      originalPrompt: 'Original system prompt',
      optimizedPrompt: 'Better system prompt',
      originalScore: 0.6,
      optimizedScore: 0.85,
      improvement: 0.25,
      iterations: 2,
      history: [
        { iteration: 0, prompt: 'Original system prompt', score: 0.6 },
        { iteration: 1, prompt: 'First variant', score: 0.75 },
        { iteration: 2, prompt: 'Better system prompt', score: 0.85 },
      ],
    });

    expect(report).toContain('# Prompt Optimization Report');
    expect(report).toContain('0.600');
    expect(report).toContain('0.850');
    expect(report).toContain('+0.250');
    expect(report).toContain('Original system prompt');
    expect(report).toContain('Better system prompt');
    expect(report).toContain('Iteration History');
    expect(report).toContain('First variant');
  });

  it('handles empty prompts', () => {
    const report = formatOptimizationReport({
      originalPrompt: '',
      optimizedPrompt: '',
      originalScore: 0,
      optimizedScore: 0,
      improvement: 0,
      iterations: 0,
      history: [{ iteration: 0, prompt: '', score: 0 }],
    });

    expect(report).toContain('(empty)');
  });

  it('escapes pipe characters in history table', () => {
    const report = formatOptimizationReport({
      originalPrompt: 'test',
      optimizedPrompt: 'test',
      originalScore: 0.5,
      optimizedScore: 0.5,
      improvement: 0,
      iterations: 1,
      history: [
        { iteration: 0, prompt: 'test', score: 0.5 },
        { iteration: 1, prompt: 'prompt with | pipe', score: 0.6 },
      ],
    });

    expect(report).toContain('prompt with \\| pipe');
  });
});
