import { describe, it, expect } from 'vitest';
import { analyzeCosts, formatCostReport } from './index.js';

describe('analyzeCosts', () => {
  it('returns empty report for empty data', () => {
    const report = analyzeCosts([]);
    expect(report.totalCurrentCost).toBe(0);
    expect(report.totalOptimizedCost).toBe(0);
    expect(report.totalSavingsUsd).toBe(0);
    expect(report.totalSavingsPercent).toBe(0);
    expect(report.recommendations).toEqual([]);
    expect(report.modelBreakdown).toEqual([]);
  });

  it('handles single model with no savings opportunity', () => {
    const report = analyzeCosts([
      {
        testName: 'test-1',
        model: 'gpt-4o-mini',
        score: 0.9,
        tokenUsage: { input: 1000, output: 500 },
      },
    ]);
    expect(report.totalCurrentCost).toBeGreaterThan(0);
    expect(report.recommendations).toHaveLength(0);
    expect(report.modelBreakdown).toHaveLength(1);
    expect(report.modelBreakdown[0].model).toBe('gpt-4o-mini');
  });

  it('recommends cheaper model when it meets threshold', () => {
    const report = analyzeCosts(
      [
        {
          testName: 'test-1',
          model: 'gpt-4o',
          score: 0.95,
          tokenUsage: { input: 10000, output: 5000 },
        },
        {
          testName: 'test-1',
          model: 'gpt-4o-mini',
          score: 0.85,
          tokenUsage: { input: 10000, output: 5000 },
        },
      ],
      0.8,
    );

    expect(report.recommendations).toHaveLength(1);
    const rec = report.recommendations[0];
    expect(rec.currentModel).toBe('gpt-4o');
    expect(rec.recommendedModel).toBe('gpt-4o-mini');
    expect(rec.savingsPercent).toBeGreaterThan(0);
    expect(rec.savingsUsd).toBeGreaterThan(0);
    expect(report.totalSavingsUsd).toBeGreaterThan(0);
  });

  it('does not recommend model below threshold', () => {
    const report = analyzeCosts(
      [
        {
          testName: 'test-1',
          model: 'gpt-4o',
          score: 0.95,
          tokenUsage: { input: 10000, output: 5000 },
        },
        {
          testName: 'test-1',
          model: 'gpt-4o-mini',
          score: 0.5,
          tokenUsage: { input: 10000, output: 5000 },
        },
      ],
      0.9,
    );

    expect(report.recommendations).toHaveLength(0);
  });

  it('skips entries without tokenUsage', () => {
    const report = analyzeCosts([{ testName: 'test-1', model: 'gpt-4o', score: 0.9 }]);
    expect(report.totalCurrentCost).toBe(0);
    expect(report.recommendations).toHaveLength(0);
    expect(report.modelBreakdown).toHaveLength(0);
  });

  it('produces model breakdown across tests', () => {
    const report = analyzeCosts([
      {
        testName: 'test-1',
        model: 'gpt-4o',
        score: 0.9,
        tokenUsage: { input: 1000, output: 500 },
      },
      {
        testName: 'test-2',
        model: 'gpt-4o',
        score: 0.85,
        tokenUsage: { input: 2000, output: 1000 },
      },
      {
        testName: 'test-1',
        model: 'gpt-4o-mini',
        score: 0.82,
        tokenUsage: { input: 1000, output: 500 },
      },
    ]);

    const gpt4o = report.modelBreakdown.find((m) => m.model === 'gpt-4o');
    expect(gpt4o).toBeDefined();
    expect(gpt4o!.testCount).toBe(2);

    const mini = report.modelBreakdown.find((m) => m.model === 'gpt-4o-mini');
    expect(mini).toBeDefined();
    expect(mini!.testCount).toBe(1);
  });

  it('sorts recommendations by savings descending', () => {
    const report = analyzeCosts(
      [
        {
          testName: 'cheap-test',
          model: 'gpt-4o',
          score: 0.95,
          tokenUsage: { input: 1000, output: 500 },
        },
        {
          testName: 'cheap-test',
          model: 'gpt-4o-mini',
          score: 0.85,
          tokenUsage: { input: 1000, output: 500 },
        },
        {
          testName: 'expensive-test',
          model: 'gpt-4o',
          score: 0.95,
          tokenUsage: { input: 100000, output: 50000 },
        },
        {
          testName: 'expensive-test',
          model: 'gpt-4o-mini',
          score: 0.85,
          tokenUsage: { input: 100000, output: 50000 },
        },
      ],
      0.8,
    );

    expect(report.recommendations.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < report.recommendations.length; i++) {
      expect(report.recommendations[i - 1].savingsUsd).toBeGreaterThanOrEqual(
        report.recommendations[i].savingsUsd,
      );
    }
  });
});

describe('formatCostReport', () => {
  it('formats empty recommendations with no-ops message', () => {
    const output = formatCostReport({
      totalCurrentCost: 0.01,
      totalOptimizedCost: 0.01,
      totalSavingsUsd: 0,
      totalSavingsPercent: 0,
      recommendations: [],
      modelBreakdown: [],
    });
    expect(output).toContain('Cost Optimization Report');
    expect(output).toContain('No cost optimization opportunities found');
  });

  it('formats recommendations as markdown table', () => {
    const output = formatCostReport({
      totalCurrentCost: 0.05,
      totalOptimizedCost: 0.01,
      totalSavingsUsd: 0.04,
      totalSavingsPercent: 80,
      recommendations: [
        {
          testName: 'test-1',
          currentModel: 'gpt-4o',
          currentCost: 0.05,
          currentScore: 0.95,
          recommendedModel: 'gpt-4o-mini',
          recommendedCost: 0.01,
          projectedScore: 0.85,
          savingsPercent: 80,
          savingsUsd: 0.04,
        },
      ],
      modelBreakdown: [],
    });
    expect(output).toContain('## Recommendations');
    expect(output).toContain('gpt-4o');
    expect(output).toContain('gpt-4o-mini');
    expect(output).toContain('80%');
  });
});
