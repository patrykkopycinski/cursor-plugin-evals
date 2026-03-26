import { describe, it, expect } from 'vitest';
import { applyPatches } from './optimizer.js';
import type { EvalYamlPatch } from './recommendations.js';

describe('applyPatches', () => {
  it('sets a threshold value', () => {
    const yaml = { defaults: { thresholds: { correctness: 0.7 } } };
    const patches: EvalYamlPatch[] = [
      { op: 'set_threshold', path: 'defaults.thresholds.correctness', value: 0.5 },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.defaults.thresholds.correctness).toBe(0.5);
  });

  it('sets repetitions', () => {
    const yaml = { defaults: { repetitions: 1 } };
    const patches: EvalYamlPatch[] = [
      { op: 'set_repetitions', path: 'defaults.repetitions', value: 5 },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.defaults.repetitions).toBe(5);
  });

  it('adds an evaluator', () => {
    const yaml = { evaluators: ['correctness'] };
    const patches: EvalYamlPatch[] = [
      { op: 'add_evaluator', path: 'evaluators', value: 'keywords' },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.evaluators).toContain('keywords');
  });

  it('does not duplicate evaluators', () => {
    const yaml = { evaluators: ['correctness', 'keywords'] };
    const patches: EvalYamlPatch[] = [
      { op: 'add_evaluator', path: 'evaluators', value: 'keywords' },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.evaluators.filter((e: string) => e === 'keywords')).toHaveLength(1);
  });

  it('removes an evaluator', () => {
    const yaml = { evaluators: ['correctness', 'keywords'] };
    const patches: EvalYamlPatch[] = [
      { op: 'remove_evaluator', path: 'evaluators', value: 'keywords' },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.evaluators).not.toContain('keywords');
  });

  it('handles missing intermediate paths gracefully', () => {
    const yaml = {};
    const patches: EvalYamlPatch[] = [
      { op: 'set_threshold', path: 'defaults.thresholds.correctness', value: 0.6 },
    ];
    const result = applyPatches(yaml, patches);
    expect(result.defaults.thresholds.correctness).toBe(0.6);
  });
});
