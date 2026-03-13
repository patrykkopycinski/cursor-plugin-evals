import { describe, it, expect } from 'vitest';
import { ChaosEngine } from './engine.js';
import { applyFault } from './injector.js';
import { formatChaosReport } from './report.js';
import type { ChaosReport, FaultRule } from './types.js';

describe('ChaosEngine', () => {
  it('creates rules from intensity preset', () => {
    const engine = new ChaosEngine({ intensity: 'low', seed: 42 });
    const rules = engine.getRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.probability === 0.05)).toBe(true);
  });

  it('creates rules from medium intensity', () => {
    const engine = new ChaosEngine({ intensity: 'medium', seed: 42 });
    const rules = engine.getRules();
    expect(rules.every((r) => r.probability === 0.2)).toBe(true);
  });

  it('creates rules from high intensity', () => {
    const engine = new ChaosEngine({ intensity: 'high', seed: 42 });
    const rules = engine.getRules();
    expect(rules.every((r) => r.probability === 0.5)).toBe(true);
  });

  it('uses custom rules when provided', () => {
    const custom: FaultRule[] = [{ kind: 'drop', probability: 1.0 }];
    const engine = new ChaosEngine({ rules: custom, seed: 42 });
    expect(engine.getRules()).toEqual(custom);
  });

  it('produces deterministic results with seed', () => {
    const results1: boolean[] = [];
    const results2: boolean[] = [];
    const engine1 = new ChaosEngine({ intensity: 'medium', seed: 123 });
    const engine2 = new ChaosEngine({ intensity: 'medium', seed: 123 });
    for (let i = 0; i < 100; i++) {
      results1.push(engine1.shouldFault('test') !== null);
      results2.push(engine2.shouldFault('test') !== null);
    }
    expect(results1).toEqual(results2);
  });

  it('respects tool filtering', () => {
    const engine = new ChaosEngine({
      rules: [{ kind: 'drop', probability: 1.0, tools: ['target'] }],
      seed: 42,
    });
    expect(engine.shouldFault('target')).not.toBeNull();
    expect(engine.shouldFault('other')).toBeNull();
  });

  it('tracks requests and generates report', () => {
    const engine = new ChaosEngine({ rules: [{ kind: 'timeout', probability: 1.0 }], seed: 1 });
    engine.recordRequest('tool-a', engine.shouldFault('tool-a'), true);
    engine.recordRequest('tool-b', engine.shouldFault('tool-b'), false);
    engine.recordRequest('tool-c', null, true);
    const report = engine.getReport();
    expect(report.totalRequests).toBe(3);
    expect(report.faultsInjected).toBe(2);
    expect(report.survivedCount).toBe(2);
    expect(report.crashedCount).toBe(1);
    expect(report.faultsByKind['timeout']).toBe(2);
  });

  it('only includes network faults when protocol is false', () => {
    const engine = new ChaosEngine({ intensity: 'medium', protocol: false, seed: 42 });
    const kinds = engine.getRules().map((r) => r.kind);
    expect(kinds).toContain('timeout');
    expect(kinds).toContain('drop');
    expect(kinds).not.toContain('corrupt');
    expect(kinds).not.toContain('error_response');
  });

  it('only includes protocol faults when network is false', () => {
    const engine = new ChaosEngine({ intensity: 'medium', network: false, seed: 42 });
    const kinds = engine.getRules().map((r) => r.kind);
    expect(kinds).toContain('corrupt');
    expect(kinds).toContain('error_response');
    expect(kinds).not.toContain('timeout');
    expect(kinds).not.toContain('drop');
  });
});

describe('applyFault', () => {
  const successFn = async () => ({ ok: true });

  it('applies timeout fault', async () => {
    const rule: FaultRule = { kind: 'timeout', probability: 1.0, delayMs: 50 };
    const { survived, error } = await applyFault(
      rule,
      'test',
      () => new Promise((r) => setTimeout(() => r({ ok: true }), 200)),
    );
    expect(survived).toBe(false);
    expect(error).toContain('timeout');
  });

  it('applies drop fault', async () => {
    const rule: FaultRule = { kind: 'drop', probability: 1.0 };
    const { result, survived } = await applyFault(rule, 'test', successFn);
    expect(result).toBeNull();
    expect(survived).toBe(false);
  });

  it('applies error_response fault', async () => {
    const rule: FaultRule = { kind: 'error_response', probability: 1.0 };
    const { result, survived } = await applyFault(rule, 'test', successFn);
    expect(survived).toBe(false);
    expect((result as Record<string, Record<string, number>>).error.code).toBe(-32603);
  });

  it('applies disconnect fault', async () => {
    const rule: FaultRule = { kind: 'disconnect', probability: 1.0 };
    const { survived, error } = await applyFault(rule, 'test', successFn);
    expect(survived).toBe(false);
    expect(error).toContain('disconnected');
  });

  it('applies slow_drain fault with delay', async () => {
    const start = Date.now();
    const rule: FaultRule = { kind: 'slow_drain', probability: 1.0, delayMs: 50 };
    const { survived } = await applyFault(rule, 'test', successFn);
    expect(survived).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('applies reorder fault (still returns result)', async () => {
    const rule: FaultRule = { kind: 'reorder', probability: 1.0 };
    const { result, survived } = await applyFault(rule, 'test', successFn);
    expect(survived).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  it('applies duplicate fault (returns result)', async () => {
    const rule: FaultRule = { kind: 'duplicate', probability: 1.0 };
    const { result, survived } = await applyFault(rule, 'test', successFn);
    expect(survived).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  it('applies corrupt fault', async () => {
    const rule: FaultRule = { kind: 'corrupt', probability: 1.0, corruptBytes: 50 };
    const { survived } = await applyFault(rule, 'test', async () => ({ data: 'hello world test data' }));
    expect(typeof survived).toBe('boolean');
  });
});

describe('formatChaosReport', () => {
  it('formats a report with grade', () => {
    const report: ChaosReport = {
      totalRequests: 100,
      faultsInjected: 20,
      survivedCount: 90,
      crashedCount: 10,
      survivalRate: 0.9,
      faultsByKind: { timeout: 10, drop: 5, corrupt: 5 },
      events: [{ timestamp: Date.now(), tool: 'test', fault: 'timeout', details: 'test detail' }],
    };
    const text = formatChaosReport(report);
    expect(text).toContain('CHAOS ENGINEERING REPORT');
    expect(text).toContain('100');
    expect(text).toContain('90.0%');
    expect(text).toContain('timeout');
    expect(text).toContain('B');
  });

  it('assigns A grade for high survival', () => {
    const report: ChaosReport = {
      totalRequests: 100,
      faultsInjected: 5,
      survivedCount: 98,
      crashedCount: 2,
      survivalRate: 0.98,
      faultsByKind: {},
      events: [],
    };
    expect(formatChaosReport(report)).toContain('A');
  });

  it('assigns F grade for low survival', () => {
    const report: ChaosReport = {
      totalRequests: 100,
      faultsInjected: 80,
      survivedCount: 30,
      crashedCount: 70,
      survivalRate: 0.3,
      faultsByKind: {},
      events: [],
    };
    expect(formatChaosReport(report)).toContain('F');
  });
});
