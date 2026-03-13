import { describe, it, expect } from 'vitest';
import { computeDimensions, getDifficultyWeight } from './dimensions.js';
import { computeQualityScore, DEFAULT_WEIGHTS } from './composite.js';
import { generateBadgeSvg } from './badge.js';
import type { RunResult, SuiteResult, TestResult } from '../core/types.js';

function makeTest(overrides: Partial<TestResult> = {}): TestResult {
  return {
    name: 'test-1',
    suite: 'suite-1',
    layer: 'unit',
    pass: true,
    toolCalls: [],
    evaluatorResults: [],
    latencyMs: 100,
    ...overrides,
  };
}

function makeSuite(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    name: 'suite-1',
    layer: 'unit',
    tests: [makeTest()],
    passRate: 1.0,
    duration: 100,
    evaluatorSummary: {},
    ...overrides,
  };
}

function makeRunResult(suites: SuiteResult[]): RunResult {
  const allTests = suites.flatMap((s) => s.tests);
  const passed = allTests.filter((t) => t.pass).length;
  return {
    runId: 'test-run',
    timestamp: new Date().toISOString(),
    config: 'test',
    suites,
    overall: {
      total: allTests.length,
      passed,
      failed: allTests.length - passed,
      skipped: 0,
      passRate: allTests.length > 0 ? passed / allTests.length : 1,
      duration: 1000,
    },
  };
}

describe('computeDimensions', () => {
  it('returns all 1.0 when all tests pass', () => {
    const result = makeRunResult([
      makeSuite({ layer: 'static', passRate: 1.0 }),
      makeSuite({ layer: 'unit', passRate: 1.0 }),
      makeSuite({ layer: 'integration', passRate: 1.0 }),
    ]);
    const dims = computeDimensions(result);
    expect(dims.structure).toBe(1.0);
    expect(dims.correctness).toBeGreaterThan(0);
    expect(dims.security).toBe(1.0);
    expect(dims.performance).toBe(1.0);
    expect(dims.agentReadiness).toBe(1.0);
  });

  it('returns 0 structure when all static tests fail', () => {
    const result = makeRunResult([
      makeSuite({
        layer: 'static',
        tests: [makeTest({ layer: 'static', pass: false })],
        passRate: 0,
      }),
    ]);
    const dims = computeDimensions(result);
    expect(dims.structure).toBe(0);
  });

  it('computes correctness from unit + integration layers', () => {
    const result = makeRunResult([
      makeSuite({
        layer: 'unit',
        tests: [makeTest({ layer: 'unit', pass: true }), makeTest({ layer: 'unit', pass: false })],
        passRate: 0.5,
      }),
    ]);
    const dims = computeDimensions(result);
    expect(dims.correctness).toBeCloseTo(0.5 * 0.6 + 1.0 * 0.4, 4);
  });

  it('computes security from evaluator means', () => {
    const result = makeRunResult([
      makeSuite({
        layer: 'unit',
        evaluatorSummary: {
          security: { mean: 0.8, min: 0.5, max: 1.0, pass: 4, total: 5 },
          'tool-poisoning': { mean: 0.6, min: 0.3, max: 0.9, pass: 3, total: 5 },
        },
      }),
    ]);
    const dims = computeDimensions(result);
    expect(dims.security).toBeCloseTo(0.7, 4);
  });

  it('returns 1.0 performance when no performance layer exists', () => {
    const result = makeRunResult([makeSuite({ layer: 'unit' })]);
    const dims = computeDimensions(result);
    expect(dims.performance).toBe(1.0);
  });

  it('computes agentReadiness from llm layer with difficulty weighting', () => {
    const result = makeRunResult([
      makeSuite({
        name: 'llm-suite',
        layer: 'llm',
        tests: [
          { ...makeTest({ layer: 'llm', pass: true }), difficulty: 'complex' } as TestResult & {
            difficulty: string;
          },
          {
            ...makeTest({ layer: 'llm', pass: false, name: 'fail' }),
            difficulty: 'simple',
          } as TestResult & { difficulty: string },
        ],
        passRate: 0.5,
        evaluatorSummary: {
          'tool-selection': { mean: 0.9, min: 0.8, max: 1.0, pass: 5, total: 5 },
          'response-quality': { mean: 0.7, min: 0.5, max: 0.9, pass: 3, total: 5 },
        },
      }),
    ]);
    const dims = computeDimensions(result);
    expect(dims.agentReadiness).toBeGreaterThan(0);
    expect(dims.agentReadiness).toBeLessThan(1);
  });
});

describe('getDifficultyWeight', () => {
  it('returns 1.0 for undefined', () => {
    expect(getDifficultyWeight(undefined)).toBe(1.0);
  });

  it('returns 1.0 for simple', () => {
    expect(getDifficultyWeight('simple')).toBe(1.0);
  });

  it('returns 1.5 for complex', () => {
    expect(getDifficultyWeight('complex')).toBe(1.5);
  });

  it('returns 1.5 for adversarial', () => {
    expect(getDifficultyWeight('adversarial')).toBe(1.5);
  });
});

describe('computeQualityScore', () => {
  it('computes composite with default weights', () => {
    const dims = {
      structure: 1.0,
      correctness: 1.0,
      security: 1.0,
      performance: 1.0,
      agentReadiness: 1.0,
    };
    const qs = computeQualityScore(dims);
    expect(qs.composite).toBe(100);
    expect(qs.grade).toBe('A');
    expect(qs.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('computes composite with custom weights', () => {
    const dims = {
      structure: 1.0,
      correctness: 0.5,
      security: 1.0,
      performance: 1.0,
      agentReadiness: 1.0,
    };
    const customWeights = {
      structure: 0,
      correctness: 1.0,
      security: 0,
      performance: 0,
      agentReadiness: 0,
    };
    const qs = computeQualityScore(dims, customWeights);
    expect(qs.composite).toBe(50);
    expect(qs.grade).toBe('F');
  });

  it('computes grade A at exactly 90', () => {
    const dims = {
      structure: 0.9,
      correctness: 0.9,
      security: 0.9,
      performance: 0.9,
      agentReadiness: 0.9,
    };
    const qs = computeQualityScore(dims);
    expect(qs.composite).toBe(90);
    expect(qs.grade).toBe('A');
  });

  it('computes grade B at 89', () => {
    const dims = {
      structure: 0.89,
      correctness: 0.89,
      security: 0.89,
      performance: 0.89,
      agentReadiness: 0.89,
    };
    const qs = computeQualityScore(dims);
    expect(qs.composite).toBe(89);
    expect(qs.grade).toBe('B');
  });

  it('computes grade B at exactly 80', () => {
    const dims = {
      structure: 0.8,
      correctness: 0.8,
      security: 0.8,
      performance: 0.8,
      agentReadiness: 0.8,
    };
    const qs = computeQualityScore(dims);
    expect(qs.composite).toBe(80);
    expect(qs.grade).toBe('B');
  });

  it('computes grade C at 79', () => {
    const dims = {
      structure: 0.79,
      correctness: 0.79,
      security: 0.79,
      performance: 0.79,
      agentReadiness: 0.79,
    };
    const qs = computeQualityScore(dims);
    expect(qs.composite).toBe(79);
    expect(qs.grade).toBe('C');
  });

  it('computes grade D at 60', () => {
    const dims = {
      structure: 0.6,
      correctness: 0.6,
      security: 0.6,
      performance: 0.6,
      agentReadiness: 0.6,
    };
    const qs = computeQualityScore(dims);
    expect(qs.composite).toBe(60);
    expect(qs.grade).toBe('D');
  });

  it('computes grade F below 60', () => {
    const dims = {
      structure: 0.59,
      correctness: 0.59,
      security: 0.59,
      performance: 0.59,
      agentReadiness: 0.59,
    };
    const qs = computeQualityScore(dims);
    expect(qs.composite).toBe(59);
    expect(qs.grade).toBe('F');
  });

  it('handles all zero dimensions', () => {
    const dims = {
      structure: 0,
      correctness: 0,
      security: 0,
      performance: 0,
      agentReadiness: 0,
    };
    const qs = computeQualityScore(dims);
    expect(qs.composite).toBe(0);
    expect(qs.grade).toBe('F');
  });
});

describe('generateBadgeSvg', () => {
  it('contains grade and percentage text', () => {
    const qs = computeQualityScore({
      structure: 0.95,
      correctness: 0.95,
      security: 0.95,
      performance: 0.95,
      agentReadiness: 0.95,
    });
    const svg = generateBadgeSvg(qs);
    expect(svg).toContain('plugin eval');
    expect(svg).toContain(`A ${Math.round(qs.composite)}%`);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('uses correct color for grade A', () => {
    const qs = computeQualityScore({
      structure: 1,
      correctness: 1,
      security: 1,
      performance: 1,
      agentReadiness: 1,
    });
    const svg = generateBadgeSvg(qs);
    expect(svg).toContain('#4c1');
  });

  it('uses correct color for grade B', () => {
    const qs = computeQualityScore({
      structure: 0.85,
      correctness: 0.85,
      security: 0.85,
      performance: 0.85,
      agentReadiness: 0.85,
    });
    const svg = generateBadgeSvg(qs);
    expect(svg).toContain('#97CA00');
  });

  it('uses correct color for grade F', () => {
    const qs = computeQualityScore({
      structure: 0.3,
      correctness: 0.3,
      security: 0.3,
      performance: 0.3,
      agentReadiness: 0.3,
    });
    const svg = generateBadgeSvg(qs);
    expect(svg).toContain('#e05d44');
  });
});
