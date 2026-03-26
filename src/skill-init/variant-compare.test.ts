import { describe, it, expect } from 'vitest';
import { compareSkillVariants } from './variant-compare.js';
import type { RunResult } from '../core/types.js';

function makeRun(scores: number[]): RunResult {
  return {
    runId: 'test', timestamp: '', config: '',
    suites: [{ name: 's', layer: 'skill', tests: scores.map((s, i) => ({ name: `t${i}`, suite: 's', layer: 'skill' as const, pass: s >= 0.5, toolCalls: [], evaluatorResults: [{ evaluator: 'correctness', score: s, pass: s >= 0.5 }], latencyMs: 100 })), passRate: scores.filter(s => s >= 0.5).length / scores.length, duration: 100, evaluatorSummary: {} }],
    overall: { total: scores.length, passed: scores.filter(s => s >= 0.5).length, failed: scores.filter(s => s < 0.5).length, skipped: 0, passRate: scores.filter(s => s >= 0.5).length / scores.length, duration: 100 },
  };
}

describe('compareSkillVariants', () => {
  it('detects improvement', () => {
    const result = compareSkillVariants(makeRun([0.5, 0.55, 0.52, 0.48, 0.51]), makeRun([0.9, 0.88, 0.92, 0.87, 0.91]), 'v1', 'v2');
    expect(result.winner).toBe('v2');
    expect(result.significant).toBe(true);
  });

  it('no significant difference', () => {
    const result = compareSkillVariants(makeRun([0.8, 0.79, 0.81]), makeRun([0.8, 0.82, 0.78]), 'v1', 'v2');
    expect(result.significant).toBe(false);
  });

  it('includes summary', () => {
    const result = compareSkillVariants(makeRun([0.5, 0.5, 0.5]), makeRun([0.9, 0.9, 0.9]), 'old', 'new');
    expect(result.summary).toContain('new');
  });
});
