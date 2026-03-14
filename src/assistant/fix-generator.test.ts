import { describe, it, expect } from 'vitest';
import { generateFix, generateFixes } from './fix-generator.js';
import type { DetectedGap } from './types.js';

describe('generateFix', () => {
  it('returns null for non-auto-fixable gaps', () => {
    const gap: DetectedGap = {
      id: 'test',
      target: 'user',
      severity: 'high',
      category: 'evaluator-coverage',
      title: 'test',
      description: 'test',
      suggestedFix: 'test',
      autoFixable: false,
    };
    expect(generateFix(gap)).toBeNull();
  });

  it('generates fix for layer coverage gap', () => {
    const gap: DetectedGap = {
      id: 'user-missing-layer-integration',
      target: 'user',
      severity: 'high',
      category: 'layer-coverage',
      title: 'No integration tests',
      description: 'Missing integration layer',
      suggestedFix: 'Add integration tests',
      autoFixable: true,
    };
    const fix = generateFix(gap);
    expect(fix).not.toBeNull();
    expect(fix!.gapId).toBe('user-missing-layer-integration');
  });

  it('generates fix for security gap', () => {
    const gap: DetectedGap = {
      id: 'no-security',
      target: 'user',
      severity: 'high',
      category: 'security',
      title: 'No security',
      description: 'Missing security',
      suggestedFix: 'Add security',
      autoFixable: true,
    };
    const fix = generateFix(gap);
    expect(fix).not.toBeNull();
    expect(fix!.testCommand).toContain('security');
  });

  it('generates fix for CI gap', () => {
    const gap: DetectedGap = {
      id: 'no-ci',
      target: 'user',
      severity: 'medium',
      category: 'infrastructure',
      title: 'No CI',
      description: 'Missing CI',
      suggestedFix: 'Add CI',
      autoFixable: true,
    };
    const fix = generateFix(gap);
    expect(fix).not.toBeNull();
    expect(fix!.testCommand).toContain('ci-init');
  });
});

describe('generateFixes', () => {
  it('filters non-fixable gaps', () => {
    const gaps: DetectedGap[] = [
      { id: 'a', target: 'user', severity: 'high', category: 'security', title: 'a', description: '', suggestedFix: '', autoFixable: true },
      { id: 'b', target: 'user', severity: 'low', category: 'config', title: 'b', description: '', suggestedFix: '', autoFixable: false },
    ];
    const fixes = generateFixes(gaps);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].gapId).toBe('a');
  });
});
