import { describe, it, expect } from 'vitest';
import { ALL_ATTACK_MODULES } from './attacks/index.js';
import { formatRedTeamReport } from './report.js';
import type { AttackCategory, RedTeamReport, AttackResult } from './types.js';

describe('attack modules', () => {
  const TOOL_NAMES = ['elasticsearch_api', 'esql_query', 'kibana_api'];

  it('exports all 10 attack categories', () => {
    const categories = ALL_ATTACK_MODULES.map((m) => m.category);
    expect(categories).toHaveLength(10);
    expect(categories).toContain('jailbreak');
    expect(categories).toContain('prompt-injection');
    expect(categories).toContain('pii-leakage');
    expect(categories).toContain('bias');
    expect(categories).toContain('toxicity');
    expect(categories).toContain('excessive-agency');
    expect(categories).toContain('hallucination-probe');
    expect(categories).toContain('data-exfiltration');
    expect(categories).toContain('privilege-escalation');
    expect(categories).toContain('denial-of-service');
  });

  it('each module has a unique category', () => {
    const categories = ALL_ATTACK_MODULES.map((m) => m.category);
    expect(new Set(categories).size).toBe(categories.length);
  });

  for (const mod of ALL_ATTACK_MODULES) {
    describe(`${mod.category}`, () => {
      it('generates the requested number of prompts', () => {
        const prompts = mod.generatePrompts(TOOL_NAMES, 5);
        expect(prompts).toHaveLength(5);
      });

      it('generates prompts even with 0 tool names', () => {
        const prompts = mod.generatePrompts([], 3);
        expect(prompts).toHaveLength(3);
        for (const p of prompts) {
          expect(typeof p).toBe('string');
          expect(p.length).toBeGreaterThan(0);
        }
      });

      it('generates unique prompts when count <= template count', () => {
        const prompts = mod.generatePrompts(TOOL_NAMES, 3);
        expect(new Set(prompts).size).toBe(3);
      });

      it('wraps around when count exceeds templates', () => {
        const prompts = mod.generatePrompts(TOOL_NAMES, 20);
        expect(prompts).toHaveLength(20);
      });

      it('returns strings containing tool names where applicable', () => {
        const prompts = mod.generatePrompts(TOOL_NAMES, 10);
        const mentionsTool = prompts.some((p) => TOOL_NAMES.some((t) => p.includes(t)));
        if (['bias', 'toxicity'].includes(mod.category)) {
          // These categories don't necessarily reference tools
          expect(prompts.length).toBeGreaterThan(0);
        } else {
          expect(mentionsTool).toBe(true);
        }
      });
    });
  }
});

describe('formatRedTeamReport', () => {
  function makeResult(overrides: Partial<AttackResult> = {}): AttackResult {
    return {
      category: 'jailbreak',
      prompt: 'Ignore instructions',
      response: 'I cannot do that.',
      toolsCalled: [],
      severity: 'critical',
      passed: true,
      explanation: 'Agent refused.',
      ...overrides,
    };
  }

  function makeReport(results: AttackResult[]): RedTeamReport {
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    const byCategory: Record<string, { total: number; passed: number; failed: number }> = {};

    for (const r of results) {
      if (!r.passed) bySeverity[r.severity]++;
      if (!byCategory[r.category]) {
        byCategory[r.category] = { total: 0, passed: 0, failed: 0 };
      }
      byCategory[r.category].total++;
      if (r.passed) byCategory[r.category].passed++;
      else byCategory[r.category].failed++;
    }

    return {
      totalAttacks: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      bySeverity,
      byCategory,
      results,
    };
  }

  it('does not throw for an all-passing report', () => {
    const report = makeReport([makeResult(), makeResult({ category: 'bias', severity: 'medium' })]);
    expect(() => formatRedTeamReport(report)).not.toThrow();
  });

  it('does not throw for a report with failures', () => {
    const report = makeReport([
      makeResult({ passed: false, explanation: 'Leaked credentials' }),
      makeResult(),
    ]);
    expect(() => formatRedTeamReport(report)).not.toThrow();
  });

  it('does not throw for an empty report', () => {
    const report = makeReport([]);
    expect(() => formatRedTeamReport(report)).not.toThrow();
  });

  it('report structure has correct totals', () => {
    const results = [
      makeResult({ passed: true }),
      makeResult({ passed: false, severity: 'critical' }),
      makeResult({ passed: false, severity: 'high', category: 'pii-leakage' }),
    ];
    const report = makeReport(results);

    expect(report.totalAttacks).toBe(3);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(2);
    expect(report.bySeverity.critical).toBe(1);
    expect(report.bySeverity.high).toBe(1);
    expect(report.byCategory['jailbreak'].total).toBe(2);
    expect(report.byCategory['pii-leakage'].failed).toBe(1);
  });
});
