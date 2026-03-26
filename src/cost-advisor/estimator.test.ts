import { describe, it, expect } from 'vitest';
import { estimateRunCost, type CostEstimate } from './estimator.js';
import type { EvalConfig } from '../core/types.js';

function makeConfig(overrides: Partial<EvalConfig> = {}): EvalConfig {
  return {
    plugin: { name: 'test-plugin' },
    suites: [],
    ...overrides,
  } as EvalConfig;
}

describe('estimateRunCost', () => {
  it('estimates cost for LLM evaluators', () => {
    const config = makeConfig({
      defaults: { judgeModel: 'gpt-5.2' },
      suites: [
        {
          name: 'test-suite',
          layer: 'llm',
          tests: [
            { name: 't1', prompt: 'test', expected: {}, evaluators: ['correctness', 'keywords'] },
            { name: 't2', prompt: 'test', expected: {}, evaluators: ['correctness'] },
          ],
        },
      ] as any,
    });

    const estimate = estimateRunCost(config);
    expect(estimate.totalEstimatedUsd).toBeGreaterThan(0);
    expect(estimate.breakdown).toHaveLength(2);
    expect(estimate.judgeCallCount).toBe(3);
  });

  it('returns zero for non-LLM layers', () => {
    const config = makeConfig({
      suites: [
        {
          name: 'static-suite',
          layer: 'static',
          tests: [{ name: 't1', check: 'manifest' }],
        },
      ] as any,
    });

    const estimate = estimateRunCost(config);
    expect(estimate.totalEstimatedUsd).toBe(0);
    expect(estimate.judgeCallCount).toBe(0);
  });

  it('multiplies by repetitions', () => {
    const config = makeConfig({
      defaults: { repetitions: 5, judgeModel: 'gpt-5.2' },
      suites: [
        {
          name: 'suite',
          layer: 'llm',
          tests: [
            { name: 't1', prompt: 'test', expected: {}, evaluators: ['correctness'] },
          ],
        },
      ] as any,
    });

    const estimate = estimateRunCost(config);
    expect(estimate.judgeCallCount).toBe(5);
  });

  it('uses cheaper model for lightweight evaluators', () => {
    const config = makeConfig({
      defaults: { judgeModel: 'gpt-5.2' },
      suites: [
        {
          name: 'suite',
          layer: 'llm',
          tests: [
            { name: 't1', prompt: 'test', expected: {}, evaluators: ['keywords'] },
          ],
        },
      ] as any,
    });

    const estimate = estimateRunCost(config);
    expect(estimate.modelBreakdown['gpt-5.2-mini']).toBeDefined();
    expect(estimate.modelBreakdown['gpt-5.2']).toBeUndefined();
  });

  it('returns empty breakdown for empty suites', () => {
    const config = makeConfig({ suites: [] });
    const estimate = estimateRunCost(config);
    expect(estimate.totalEstimatedUsd).toBe(0);
    expect(estimate.breakdown).toHaveLength(0);
  });
});
