import { describe, it, expect } from 'vitest';
import { detectGaps, formatGapReport } from './gap-detector.js';
import type { CodebaseProfile, CoverageAuditReport } from './types.js';
import type { Layer } from '../core/types.js';

function makeProfile(overrides: Partial<CodebaseProfile> = {}): CodebaseProfile {
  return {
    projectKind: 'cursor-plugin',
    rootDir: '/tmp/test',
    manifest: null,
    skills: [],
    mcpTools: [],
    evalFiles: [],
    toolCoverage: new Map(),
    layerCoverage: { unit: 0, static: 0, integration: 0, llm: 0, performance: 0, skill: 0 } as Record<Layer, number>,
    evaluatorsUsed: [],
    evaluatorsAvailable: [],
    configIssues: [],
    hasCI: false,
    hasCiThresholds: false,
    hasFixtures: false,
    hasFingerprints: false,
    scanTimestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeAudit(overrides: Partial<CoverageAuditReport> = {}): CoverageAuditReport {
  return {
    timestamp: new Date().toISOString(),
    overallScore: 50,
    gaps: [],
    summary: {
      totalTools: 5,
      coveredTools: 2,
      layerCoverage: {},
      evaluatorCoverage: 0.2,
      difficultyDistribution: {},
      securityCoverage: false,
      performanceCoverage: false,
      regressionBaseline: false,
    },
    ...overrides,
  };
}

describe('detectGaps', () => {
  it('converts audit gaps to detected gaps', () => {
    const audit = makeAudit({
      gaps: [{
        id: 'test-gap',
        severity: 'high',
        category: 'coverage',
        title: 'Missing tests',
        description: 'No tests exist',
        recommendation: 'Add tests',
        autoFixable: true,
      }],
    });
    const profile = makeProfile();
    const gaps = detectGaps(profile, audit);
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    expect(gaps.some((g) => g.target === 'user')).toBe(true);
  });

  it('detects config issues from profile', () => {
    const profile = makeProfile({
      configIssues: [{
        severity: 'error',
        category: 'config',
        message: 'Bad config',
        fix: 'Fix it',
      }],
    });
    const audit = makeAudit();
    const gaps = detectGaps(profile, audit);
    expect(gaps.some((g) => g.category === 'config')).toBe(true);
  });

  it('returns sorted by severity', () => {
    const audit = makeAudit({
      gaps: [
        { id: 'low', severity: 'low', category: 'a', title: 'Low', description: '', recommendation: '', autoFixable: false },
        { id: 'high', severity: 'high', category: 'a', title: 'High', description: '', recommendation: '', autoFixable: false },
      ],
    });
    const gaps = detectGaps(makeProfile(), audit);
    const userGaps = gaps.filter((g) => g.id.startsWith('user-'));
    if (userGaps.length >= 2) {
      expect(userGaps[0].severity === 'high' || userGaps[0].severity === 'critical').toBe(true);
    }
  });
});

describe('formatGapReport', () => {
  it('formats empty gaps', () => {
    const report = formatGapReport([]);
    expect(report).toContain('No gaps detected');
  });

  it('separates user and framework gaps', () => {
    const gaps = [
      { id: 'u1', target: 'user' as const, severity: 'high' as const, category: 'test', title: 'User gap', description: 'desc', suggestedFix: 'fix', autoFixable: true },
      { id: 'f1', target: 'framework' as const, severity: 'low' as const, category: 'eval', title: 'Framework gap', description: 'desc', suggestedFix: 'fix', autoFixable: false },
    ];
    const report = formatGapReport(gaps);
    expect(report).toContain('User Repository Gaps');
    expect(report).toContain('Framework Gaps');
  });
});
