import { describe, it, expect } from 'vitest';
import { TraceCollector } from './observe.js';

describe('TraceCollector', () => {
  it('records function calls with timing', async () => {
    const collector = new TraceCollector();
    const fn = collector.wrap('myFunc', async (x: number) => x * 2);
    const result = await fn(5);
    expect(result).toBe(10);
    const entries = collector.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('myFunc');
    expect(entries[0].result).toBe(10);
    expect(entries[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(entries[0].error).toBeUndefined();
  });

  it('records errors', async () => {
    const collector = new TraceCollector();
    const fn = collector.wrap('failing', async () => { throw new Error('boom'); });
    await expect(fn()).rejects.toThrow('boom');
    const entries = collector.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].error).toBe('boom');
  });

  it('tracks nested calls', async () => {
    const collector = new TraceCollector();
    const inner = collector.wrap('inner', async () => 'done');
    const outer = collector.wrap('outer', async () => inner());
    await outer();
    const entries = collector.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('outer');
    expect(entries[1].name).toBe('inner');
  });

  it('computes summary metrics', async () => {
    const collector = new TraceCollector();
    const fn = collector.wrap('fast', async () => 42);
    await fn();
    await fn();
    const summary = collector.getSummary();
    expect(summary.totalCalls).toBe(2);
    expect(summary.uniqueFunctions).toBe(1);
    expect(summary.errors).toBe(0);
    expect(summary.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('resets state', async () => {
    const collector = new TraceCollector();
    const fn = collector.wrap('x', async () => 1);
    await fn();
    collector.reset();
    expect(collector.getEntries()).toHaveLength(0);
  });

  it('preserves function return types', async () => {
    const collector = new TraceCollector();
    const fn = collector.wrap('typed', async (a: string, b: number) => ({ a, b }));
    const result = await fn('hello', 42);
    expect(result).toEqual({ a: 'hello', b: 42 });
  });
});
