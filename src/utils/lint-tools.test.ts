import { describe, it, expect, vi } from 'vitest';
import { lintToolMappings, formatLintToolsReport } from './lint-tools.js';

vi.mock('node:fs/promises', async () => {
  return {
    readdir: vi.fn(async (dir: string) => {
      if (dir.endsWith('scripts')) {
        return ['case-manager.js', 'alert-triage.js', 'helpers.js', 'subdir'];
      }
      if (dir.endsWith('subdir')) {
        return ['nested-tool.sh'];
      }
      return [];
    }),
    stat: vi.fn(async (path: string) => {
      if (path.endsWith('subdir')) {
        return { isDirectory: () => true, isFile: () => false };
      }
      return { isDirectory: () => false, isFile: () => true };
    }),
  };
});

describe('lintToolMappings', () => {
  it('detects unmapped scripts', async () => {
    const result = await lintToolMappings({
      scriptsDir: '/repo/scripts',
      mapping: {
        'case-manager.js': 'case_manager',
      },
    });

    expect(result.totalScripts).toBe(4);
    expect(result.totalMappings).toBe(1);
    expect(result.unmappedScripts.length).toBeGreaterThan(0);
    expect(result.pass).toBe(false);
  });

  it('detects orphaned mappings', async () => {
    const result = await lintToolMappings({
      scriptsDir: '/repo/scripts',
      mapping: {
        'case-manager.js': 'case_manager',
        'alert-triage.js': 'alert_triage',
        'helpers.js': 'helpers',
        'nested-tool.sh': 'nested_tool',
        'nonexistent.js': 'ghost',
      },
    });

    expect(result.orphanedMappings).toContain('nonexistent.js');
  });

  it('passes when all scripts are mapped and valid', async () => {
    const result = await lintToolMappings({
      scriptsDir: '/repo/scripts',
      mapping: {
        'case-manager.js': 'case_manager',
        'alert-triage.js': 'alert_triage',
        'helpers.js': 'helpers',
        'nested-tool.sh': 'nested_tool',
      },
    });

    expect(result.pass).toBe(true);
  });
});

describe('formatLintToolsReport', () => {
  it('renders a passing report', () => {
    const report = formatLintToolsReport({
      unmappedScripts: [],
      orphanedMappings: [],
      validMappings: ['a.js'],
      totalScripts: 1,
      totalMappings: 1,
      pass: true,
    });
    expect(report).toContain('All scripts are mapped');
    expect(report).toContain('Scripts found: 1');
  });

  it('renders a failing report with details', () => {
    const report = formatLintToolsReport({
      unmappedScripts: ['unmapped.js'],
      orphanedMappings: ['ghost.js'],
      validMappings: ['valid.js'],
      totalScripts: 2,
      totalMappings: 2,
      pass: false,
    });
    expect(report).toContain('unmapped.js');
    expect(report).toContain('ghost.js');
    expect(report).toContain('Lint failed');
  });
});
