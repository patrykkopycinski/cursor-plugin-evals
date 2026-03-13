import { describe, it, expect } from 'vitest';
import { SAFE_MCP_TECHNIQUES } from './techniques.js';
import { buildComplianceReport, formatComplianceReport } from './mapping.js';

describe('SAFE_MCP_TECHNIQUES', () => {
  it('has 26 techniques', () => {
    expect(SAFE_MCP_TECHNIQUES.length).toBe(26);
  });

  it('all techniques have unique IDs', () => {
    const ids = SAFE_MCP_TECHNIQUES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all techniques have required fields', () => {
    for (const t of SAFE_MCP_TECHNIQUES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.tactic).toBeTruthy();
      expect(t.description).toBeTruthy();
    }
  });
});

describe('buildComplianceReport', () => {
  it('reports full coverage when rules + red-team cover a technique', () => {
    const report = buildComplianceReport(
      ['tool-poisoning', 'prompt-injection'],
      ['tool-poisoning', 'prompt-injection'],
    );
    const toolPoisoning = report.mappings.find((m) => m.techniqueId === 'SAFE-T1001');
    expect(toolPoisoning!.coverage).toBe('full');
    expect(toolPoisoning!.coveredBy.length).toBe(2);
  });

  it('reports partial coverage when only rule covers', () => {
    const report = buildComplianceReport(['command-injection'], []);
    const cmdInj = report.mappings.find((m) => m.techniqueId === 'SAFE-T1701');
    expect(cmdInj!.coverage).toBe('partial');
  });

  it('reports none when nothing covers a technique', () => {
    const report = buildComplianceReport([], []);
    expect(report.uncovered).toBe(26);
    expect(report.coveragePercent).toBe(0);
  });

  it('computes overall coverage correctly', () => {
    const allRules = [
      'tool-poisoning', 'prompt-injection', 'command-injection',
      'privilege-escalation', 'token-mismanagement', 'sensitive-data-exposure',
      'data-exfiltration', 'supply-chain', 'shadow-server',
      'insecure-deserialization', 'unsafe-redirect', 'missing-audit',
      'context-oversharing', 'resource-exhaustion', 'denial-of-service',
      'insufficient-auth', 'cross-tool-contamination',
    ];
    const allRedTeam = [
      'tool-poisoning', 'prompt-injection', 'credential-theft',
      'data-exfiltration', 'privilege-escalation', 'resource-abuse',
      'system-prompt-leak', 'ssrf', 'path-traversal', 'supply-chain',
    ];
    const report = buildComplianceReport(allRules, allRedTeam);
    expect(report.coveragePercent).toBeGreaterThan(80);
    expect(report.coveredFull).toBeGreaterThan(10);
  });

  it('includes tactic-level coverage', () => {
    const report = buildComplianceReport(['tool-poisoning'], ['tool-poisoning']);
    expect(report.tacticCoverage).toBeDefined();
    expect(report.tacticCoverage['initial_access']).toBeDefined();
    expect(report.tacticCoverage['initial_access'].covered).toBeGreaterThan(0);
  });
});

describe('formatComplianceReport', () => {
  it('formats a report', () => {
    const report = buildComplianceReport(['tool-poisoning'], []);
    const text = formatComplianceReport(report);
    expect(text).toContain('SAFE-MCP COMPLIANCE REPORT');
    expect(text).toContain('SAFE-T1001');
    expect(text).toContain('Tool Poisoning');
  });

  it('shows coverage percentages', () => {
    const report = buildComplianceReport(['tool-poisoning'], ['tool-poisoning']);
    const text = formatComplianceReport(report);
    expect(text).toContain('%');
    expect(text).toContain('●');
  });
});
