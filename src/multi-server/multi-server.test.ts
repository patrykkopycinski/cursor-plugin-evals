import { describe, it, expect } from 'vitest';
import { CROSS_SERVER_SCENARIOS } from './scenarios.js';
import { analyzeResults, formatCrossServerReport } from './analyzer.js';
import type { CrossServerResult } from './types.js';

describe('CROSS_SERVER_SCENARIOS', () => {
  it('has at least 6 scenarios', () => {
    expect(CROSS_SERVER_SCENARIOS.length).toBeGreaterThanOrEqual(6);
  });

  it('covers all attack vectors', () => {
    const vectors = new Set(CROSS_SERVER_SCENARIOS.map(s => s.attackVector));
    expect(vectors.has('description_injection')).toBe(true);
    expect(vectors.has('response_hijack')).toBe(true);
    expect(vectors.has('context_manipulation')).toBe(true);
    expect(vectors.has('tool_shadowing')).toBe(true);
    expect(vectors.has('data_exfiltration_relay')).toBe(true);
  });

  it('all scenarios have required fields', () => {
    for (const s of CROSS_SERVER_SCENARIOS) {
      expect(s.name).toBeTruthy();
      expect(s.maliciousTool.name).toBeTruthy();
      expect(s.prompt).toBeTruthy();
      expect(s.targetTool).toBeTruthy();
    }
  });
});

describe('analyzeResults', () => {
  it('reports perfect resistance', () => {
    const results: CrossServerResult[] = CROSS_SERVER_SCENARIOS.map(tc => ({
      testCase: tc, resisted: true, detected: true,
      toolsCalled: [tc.targetTool], explanation: 'Correctly resisted',
    }));
    const report = analyzeResults(results);
    expect(report.resistanceRate).toBe(1);
    expect(report.vulnerableVectors.length).toBe(0);
  });

  it('reports failures', () => {
    const results: CrossServerResult[] = [{
      testCase: CROSS_SERVER_SCENARIOS[0],
      resisted: false, detected: false,
      toolsCalled: ['helpful_logger', 'elasticsearch_api'],
      explanation: 'Agent called malicious tool first',
    }];
    const report = analyzeResults(results);
    expect(report.failedCount).toBe(1);
    expect(report.vulnerableVectors).toContain('description_injection');
  });

  it('handles empty results', () => {
    const report = analyzeResults([]);
    expect(report.totalTests).toBe(0);
    expect(report.resistanceRate).toBe(1);
  });
});

describe('formatCrossServerReport', () => {
  it('formats report with grade', () => {
    const results: CrossServerResult[] = CROSS_SERVER_SCENARIOS.slice(0, 2).map(tc => ({
      testCase: tc, resisted: true, detected: false,
      toolsCalled: [tc.targetTool], explanation: '',
    }));
    const report = analyzeResults(results);
    const text = formatCrossServerReport(report);
    expect(text).toContain('MULTI-SERVER ATTACK REPORT');
    expect(text).toContain('Resistance rate');
    expect(text).toContain('100.0%');
  });

  it('shows vulnerable vectors', () => {
    const results: CrossServerResult[] = [{
      testCase: CROSS_SERVER_SCENARIOS[0],
      resisted: false, detected: false,
      toolsCalled: [], explanation: 'Failed',
    }];
    const report = analyzeResults(results);
    const text = formatCrossServerReport(report);
    expect(text).toContain('Vulnerable attack vectors');
    expect(text).toContain('description_injection');
  });
});
