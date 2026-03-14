import { existsSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { scanCodebase, formatCodebaseReport } from './codebase-scanner.js';
import { auditCoverage, formatAuditReport } from './coverage-analyzer.js';
import { detectGaps, formatGapReport } from './gap-detector.js';
import { generateFixes } from './fix-generator.js';

const TARGET = '/Users/patrykkopycinski/Projects/elastic-cursor-plugin';
const canRun = existsSync(TARGET);

describe.skipIf(!canRun)('onboarding pipeline against elastic-cursor-plugin', () => {
  it('scans the codebase successfully', async () => {
    const profile = await scanCodebase(TARGET);

    console.log(formatCodebaseReport(profile));

    expect(profile.projectKind).toBe('cursor-plugin');
    expect(profile.skills.length).toBeGreaterThan(0);
    expect(profile.rootDir).toBe(TARGET);
    expect(profile.scanTimestamp).toBeTruthy();
  });

  it('runs coverage audit', async () => {
    const profile = await scanCodebase(TARGET);
    const audit = auditCoverage(profile);

    console.log(formatAuditReport(audit));

    expect(audit.overallScore).toBeGreaterThanOrEqual(0);
    expect(audit.overallScore).toBeLessThanOrEqual(100);
    expect(audit.gaps.length).toBeGreaterThan(0);
    expect(audit.summary.totalTools).toBeGreaterThanOrEqual(0);
  });

  it('detects gaps', async () => {
    const profile = await scanCodebase(TARGET);
    const audit = auditCoverage(profile);
    const gaps = detectGaps(profile, audit);

    console.log(formatGapReport(gaps));

    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.target === 'user' || g.target === 'framework')).toBe(true);
    expect(gaps.every((g) => g.severity)).toBe(true);
  });

  it('generates fixes for auto-fixable gaps', async () => {
    const profile = await scanCodebase(TARGET);
    const audit = auditCoverage(profile);
    const gaps = detectGaps(profile, audit);
    const fixes = generateFixes(gaps);

    console.log(`Generated ${fixes.length} fixes:`);
    for (const fix of fixes) {
      console.log(`  - [${fix.gapId}] ${fix.description}`);
    }

    const autoFixable = gaps.filter((g) => g.autoFixable);
    expect(fixes.length).toBeLessThanOrEqual(autoFixable.length);
  });
});
