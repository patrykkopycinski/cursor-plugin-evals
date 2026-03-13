import { describe, it, expect } from 'vitest';
import {
  extractTrajectory, computeLevenshteinDistance, computeLCS,
  scoreTrajectory, TrajectoryEvaluator,
} from './trajectory.js';
import type { ToolCallRecord } from '../core/types.js';

const makeCall = (tool: string, isError = false): ToolCallRecord => ({
  tool, args: {}, result: { content: [{ type: 'text', text: 'ok' }], isError }, latencyMs: 100,
});

describe('extractTrajectory', () => {
  it('extracts steps from tool calls', () => {
    const calls = [makeCall('a'), makeCall('b', true), makeCall('c')];
    const trajectory = extractTrajectory(calls);
    expect(trajectory).toHaveLength(3);
    expect(trajectory[0]).toEqual({ tool: 'a', args: {}, success: true });
    expect(trajectory[1].success).toBe(false);
  });
});

describe('computeLevenshteinDistance', () => {
  it('returns 0 for identical sequences', () => {
    expect(computeLevenshteinDistance(['a', 'b'], ['a', 'b'])).toBe(0);
  });
  it('returns length for empty vs non-empty', () => {
    expect(computeLevenshteinDistance([], ['a', 'b'])).toBe(2);
  });
  it('computes correct distance', () => {
    expect(computeLevenshteinDistance(['a', 'b', 'c'], ['a', 'c'])).toBe(1);
  });
});

describe('computeLCS', () => {
  it('returns full length for identical sequences', () => {
    expect(computeLCS(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(3);
  });
  it('returns 0 for completely different', () => {
    expect(computeLCS(['a'], ['b'])).toBe(0);
  });
  it('computes correct LCS', () => {
    expect(computeLCS(['a', 'b', 'c', 'd'], ['a', 'c', 'd'])).toBe(3);
  });
});

describe('scoreTrajectory', () => {
  it('scores perfect golden path match as high', () => {
    const steps = [{ tool: 'a', args: {}, success: true }, { tool: 'b', args: {}, success: true }];
    const metrics = scoreTrajectory(steps, ['a', 'b']);
    expect(metrics.pathSimilarity).toBe(1);
    expect(metrics.stepEfficiency).toBe(1);
    expect(metrics.overall).toBeGreaterThan(0.8);
  });

  it('penalizes extra steps', () => {
    const steps = [
      { tool: 'a', args: {}, success: true },
      { tool: 'x', args: {}, success: true },
      { tool: 'b', args: {}, success: true },
    ];
    const metrics = scoreTrajectory(steps, ['a', 'b']);
    expect(metrics.stepEfficiency).toBeLessThan(1);
  });

  it('penalizes redundant calls', () => {
    const steps = [
      { tool: 'a', args: {}, success: true },
      { tool: 'a', args: {}, success: true },
      { tool: 'b', args: {}, success: true },
    ];
    const metrics = scoreTrajectory(steps, ['a', 'b']);
    expect(metrics.redundancyPenalty).toBeGreaterThan(0);
  });

  it('rewards error recovery', () => {
    const steps = [
      { tool: 'a', args: {}, success: false },
      { tool: 'a', args: {}, success: true },
      { tool: 'b', args: {}, success: true },
    ];
    const metrics = scoreTrajectory(steps, ['a', 'b']);
    expect(metrics.errorRecoveryBonus).toBeGreaterThan(0);
  });

  it('handles empty trajectory', () => {
    const metrics = scoreTrajectory([], ['a', 'b']);
    expect(metrics.pathSimilarity).toBe(0);
    expect(metrics.overall).toBeGreaterThanOrEqual(0);
    expect(metrics.overall).toBeLessThanOrEqual(1);
  });

  it('uses expectedTools when no goldenPath', () => {
    const steps = [{ tool: 'a', args: {}, success: true }, { tool: 'c', args: {}, success: true }];
    const metrics = scoreTrajectory(steps, undefined, ['a', 'b', 'c']);
    expect(metrics.pathSimilarity).toBeCloseTo(2 / 3);
  });
});

describe('TrajectoryEvaluator', () => {
  it('evaluates context and returns result', async () => {
    const evaluator = new TrajectoryEvaluator();
    const result = await evaluator.evaluate({
      testName: 'test',
      prompt: 'do stuff',
      toolCalls: [makeCall('a'), makeCall('b')],
      expected: { goldenPath: ['a', 'b'] },
    });
    expect(result.evaluator).toBe('trajectory');
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.pass).toBe(true);
    expect(result.metadata).toBeDefined();
  });

  it('fails when trajectory is very different', async () => {
    const evaluator = new TrajectoryEvaluator();
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [makeCall('x'), makeCall('y'), makeCall('z')],
      expected: { goldenPath: ['a', 'b'] },
    });
    expect(result.score).toBeLessThan(0.6);
  });

  it('uses custom threshold from config', async () => {
    const evaluator = new TrajectoryEvaluator();
    const result = await evaluator.evaluate({
      testName: 'test',
      toolCalls: [makeCall('a')],
      expected: { goldenPath: ['a', 'b'] },
      config: { trajectoryThreshold: 0.9 },
    });
    expect(result.pass).toBe(false);
  });
});
