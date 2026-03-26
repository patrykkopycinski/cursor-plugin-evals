import { describe, it, expect } from 'vitest';
import { computeAblation } from './runner.js';
import type { RunResult } from '../core/types.js';

function makeRunResult(scores: number[]): RunResult {
  return {
    runId: 'test-run',
    timestamp: new Date().toISOString(),
    config: 'test-config',
    suites: [
      {
        name: 'test-suite',
        layer: 'llm',
        tests: scores.map((score, i) => ({
          name: `test-${i}`,
          suite: 'test-suite',
          layer: 'llm',
          pass: score >= 0.5,
          toolCalls: [],
          evaluatorResults: [
            {
              evaluator: 'score-evaluator',
              score,
              pass: score >= 0.5,
            },
          ],
          latencyMs: 100,
        })),
        passRate: scores.filter((s) => s >= 0.5).length / scores.length,
        duration: 1000,
        evaluatorSummary: {},
      },
    ],
    overall: {
      total: scores.length,
      passed: scores.filter((s) => s >= 0.5).length,
      failed: scores.filter((s) => s < 0.5).length,
      skipped: 0,
      passRate: scores.filter((s) => s >= 0.5).length / scores.length,
      duration: 1000,
    },
  };
}

describe('computeAblation', () => {
  it('detects improvement when skill clearly helps', () => {
    const withSkill = makeRunResult([0.9, 0.85, 0.95, 0.88, 0.92]);
    const withoutSkill = makeRunResult([0.4, 0.35, 0.45, 0.38, 0.42]);

    const result = computeAblation(withSkill, withoutSkill);

    expect(result.skillHelps).toBe(true);
    expect(result.delta).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.withSkillMean).toBeCloseTo(0.9, 1);
    expect(result.withoutSkillMean).toBeCloseTo(0.4, 1);
    expect(result.summary).toContain('improved');
    expect(result.summary).toContain('statistically significant');
  });

  it('detects no improvement when scores are virtually identical', () => {
    const withSkill = makeRunResult([0.5, 0.52, 0.48, 0.51, 0.49]);
    const withoutSkill = makeRunResult([0.5, 0.51, 0.49, 0.5, 0.5]);

    const result = computeAblation(withSkill, withoutSkill);

    expect(result.skillHelps).toBe(false);
    expect(result.pValue).toBeGreaterThan(0.05);
    expect(result.summary).toContain('not statistically significant');
  });

  it('falls back to pValue=1 when fewer than 2 scores per run', () => {
    const withSkill = makeRunResult([0.9]);
    const withoutSkill = makeRunResult([0.4]);

    const result = computeAblation(withSkill, withoutSkill);

    expect(result.pValue).toBe(1);
    expect(result.skillHelps).toBe(false);
  });

  it('reports degraded when skill hurts performance', () => {
    const withSkill = makeRunResult([0.3, 0.32, 0.28, 0.31, 0.29]);
    const withoutSkill = makeRunResult([0.8, 0.82, 0.78, 0.81, 0.79]);

    const result = computeAblation(withSkill, withoutSkill);

    expect(result.delta).toBeLessThan(0);
    expect(result.skillHelps).toBe(false);
    expect(result.summary).toContain('degraded');
  });

  it('uses pass/fail score when evaluatorResults is empty', () => {
    const makeRunWithPassFail = (passes: boolean[]): RunResult => ({
      runId: 'test-run',
      timestamp: new Date().toISOString(),
      config: 'test-config',
      suites: [
        {
          name: 'test-suite',
          layer: 'llm',
          tests: passes.map((pass, i) => ({
            name: `test-${i}`,
            suite: 'test-suite',
            layer: 'llm',
            pass,
            toolCalls: [],
            evaluatorResults: [],
            latencyMs: 100,
          })),
          passRate: passes.filter(Boolean).length / passes.length,
          duration: 1000,
          evaluatorSummary: {},
        },
      ],
      overall: {
        total: passes.length,
        passed: passes.filter(Boolean).length,
        failed: passes.filter((p) => !p).length,
        skipped: 0,
        passRate: passes.filter(Boolean).length / passes.length,
        duration: 1000,
      },
    });

    const withSkill = makeRunWithPassFail([true, true, true, true, true]);
    const withoutSkill = makeRunWithPassFail([false, false, false, false, false]);

    const result = computeAblation(withSkill, withoutSkill);

    expect(result.withSkillMean).toBe(1);
    expect(result.withoutSkillMean).toBe(0);
    expect(result.delta).toBe(1);
    expect(result.skillHelps).toBe(true);
  });
});
