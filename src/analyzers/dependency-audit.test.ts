import { describe, it, expect, vi } from 'vitest';
import { auditPluginDependencies, formatDependencyAuditReport } from './dependency-audit.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'fs/promises';

const mockReadFile = vi.mocked(readFile);

describe('auditPluginDependencies', () => {
  it('handles missing package.json gracefully', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await auditPluginDependencies('/nonexistent');
    expect(result.totalDependencies).toBe(0);
    expect(result.directDependencies).toBe(0);
    expect(result.riskIndicators).toEqual([]);
    expect(result.overallRisk).toBe('low');
  });

  it('handles invalid JSON gracefully', async () => {
    mockReadFile.mockResolvedValueOnce('not json {{{');
    const result = await auditPluginDependencies('/bad');
    expect(result.overallRisk).toBe('high');
    expect(result.riskIndicators[0].indicator).toBe('invalid-package-json');
  });

  it('detects postinstall scripts', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        scripts: { postinstall: 'node malicious.js' },
        dependencies: { somelib: '1.0.0' },
      }),
    );
    const result = await auditPluginDependencies('/plugin');
    const scriptIndicator = result.riskIndicators.find((i) => i.indicator === 'lifecycle-script');
    expect(scriptIndicator).toBeDefined();
    expect(scriptIndicator!.severity).toBe('high');
    expect(scriptIndicator!.description).toContain('postinstall');
  });

  it('detects excessive dependencies', async () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i < 110; i++) deps[`pkg-${i}`] = '1.0.0';
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ dependencies: deps }));
    const result = await auditPluginDependencies('/plugin');
    const excessive = result.riskIndicators.find(
      (i) => i.indicator === 'excessive-dependencies',
    );
    expect(excessive).toBeDefined();
    expect(excessive!.severity).toBe('high');
  });

  it('detects native compilation markers', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        dependencies: { 'node-gyp': '9.0.0' },
      }),
    );
    const result = await auditPluginDependencies('/plugin');
    const native = result.riskIndicators.find((i) => i.indicator === 'native-compilation');
    expect(native).toBeDefined();
  });

  it('detects non-registry sources', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        dependencies: { sketchy: 'git+https://evil.com/repo.git' },
      }),
    );
    const result = await auditPluginDependencies('/plugin');
    const nonReg = result.riskIndicators.find((i) => i.indicator === 'non-registry-source');
    expect(nonReg).toBeDefined();
    expect(nonReg!.severity).toBe('high');
  });

  it('detects typosquatting suspects', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        dependencies: { lodasH: '4.0.0' },
      }),
    );
    const result = await auditPluginDependencies('/plugin');
    const typo = result.riskIndicators.find((i) => i.indicator === 'typosquatting-suspect');
    expect(typo).toBeDefined();
    expect(typo!.severity).toBe('critical');
    expect(typo!.description).toContain('lodash');
  });

  it('returns low risk for clean package.json', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        name: 'clean-plugin',
        dependencies: { lodash: '^4.17.21', express: '^4.18.0' },
      }),
    );
    const result = await auditPluginDependencies('/plugin');
    expect(result.overallRisk).toBe('low');
    expect(result.directDependencies).toBe(2);
  });

  it('classifies overall risk as critical when typosquatting is found', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        dependencies: { requst: '2.0.0' },
      }),
    );
    const result = await auditPluginDependencies('/plugin');
    expect(result.overallRisk).toBe('critical');
  });
});

describe('formatDependencyAuditReport', () => {
  it('formats clean report', () => {
    const report = formatDependencyAuditReport({
      totalDependencies: 5,
      directDependencies: 3,
      riskIndicators: [],
      overallRisk: 'low',
    });
    expect(report).toContain('# Dependency Audit Report');
    expect(report).toContain('LOW');
    expect(report).toContain('3 direct');
    expect(report).toContain('No risk indicators');
  });

  it('formats report with indicators', () => {
    const report = formatDependencyAuditReport({
      totalDependencies: 120,
      directDependencies: 110,
      riskIndicators: [
        {
          severity: 'high',
          indicator: 'excessive-dependencies',
          description: '110 direct dependencies is unusually high',
          recommendation: 'Audit dependencies.',
        },
      ],
      overallRisk: 'medium',
    });
    expect(report).toContain('## Risk Indicators (1)');
    expect(report).toContain('excessive-dependencies');
    expect(report).toContain('Audit dependencies.');
  });
});
