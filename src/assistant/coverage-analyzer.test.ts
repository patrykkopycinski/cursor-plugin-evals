import { describe, it, expect } from 'vitest';
import { auditCoverage, formatAuditReport } from './coverage-analyzer.js';
import type { CodebaseProfile } from './types.js';
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
    evaluatorsAvailable: ['correctness', 'tool-selection', 'security', 'groundedness'],
    configIssues: [],
    hasCI: false,
    hasCiThresholds: false,
    hasFixtures: false,
    hasFingerprints: false,
    scanTimestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('auditCoverage', () => {
  it('detects missing layer coverage', () => {
    const profile = makeProfile();
    const report = auditCoverage(profile);
    const layerGaps = report.gaps.filter((g) => g.category === 'layer-coverage');
    expect(layerGaps.length).toBeGreaterThan(0);
  });

  it('detects missing security evaluators', () => {
    const profile = makeProfile({ evaluatorsUsed: ['correctness'] });
    const report = auditCoverage(profile);
    const secGap = report.gaps.find((g) => g.id === 'no-security-eval');
    expect(secGap).toBeDefined();
    expect(secGap!.severity).toBe('high');
  });

  it('detects missing CI', () => {
    const profile = makeProfile({ hasCI: false });
    const report = auditCoverage(profile);
    const ciGap = report.gaps.find((g) => g.id === 'no-ci');
    expect(ciGap).toBeDefined();
  });

  it('detects missing fixtures', () => {
    const profile = makeProfile({ hasFixtures: false });
    const report = auditCoverage(profile);
    const gap = report.gaps.find((g) => g.id === 'no-fixtures');
    expect(gap).toBeDefined();
  });

  it('detects missing regression baseline', () => {
    const profile = makeProfile({ hasFingerprints: false });
    const report = auditCoverage(profile);
    const gap = report.gaps.find((g) => g.id === 'no-regression-baseline');
    expect(gap).toBeDefined();
  });

  it('reports fewer gaps for well-configured projects', () => {
    const profile = makeProfile({
      evalFiles: [
        { path: 'eval.yaml', layer: 'llm', testCount: 10, tools: ['t1'], evaluators: ['correctness', 'security'] },
        { path: 'int.yaml', layer: 'integration', testCount: 5, tools: ['t1'], evaluators: [] },
        { path: 'static.yaml', layer: 'static', testCount: 3, tools: [], evaluators: [] },
        { path: 'unit.yaml', layer: 'unit', testCount: 2, tools: [], evaluators: [] },
      ],
      layerCoverage: { unit: 2, static: 3, integration: 5, llm: 10, performance: 0, skill: 0 } as Record<Layer, number>,
      evaluatorsUsed: ['correctness', 'security', 'tool-selection'],
      hasCI: true,
      hasCiThresholds: true,
      hasFixtures: true,
      hasFingerprints: true,
    });
    const report = auditCoverage(profile);
    expect(report.overallScore).toBeGreaterThan(50);
  });
});

describe('formatAuditReport', () => {
  it('produces markdown output', () => {
    const profile = makeProfile();
    const report = auditCoverage(profile);
    const formatted = formatAuditReport(report);
    expect(formatted).toContain('Coverage Audit Report');
    expect(formatted).toContain('Gaps');
  });
});
