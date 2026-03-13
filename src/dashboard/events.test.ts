import { describe, it, expect } from 'vitest';
import { EvalEventEmitter } from './events.js';
import type { EvalEvent } from './events.js';

describe('EvalEventEmitter', () => {
  it('delivers events to subscribers', () => {
    const emitter = new EvalEventEmitter();
    const received: EvalEvent[] = [];

    emitter.subscribe((event) => {
      received.push(event);
    });

    emitter.emit({ type: 'test-start', suite: 'unit', test: 'foo' });
    emitter.emit({ type: 'test-pass', suite: 'unit', test: 'foo', score: 0.95 });

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({ type: 'test-start', suite: 'unit', test: 'foo' });
    expect(received[1]).toEqual({ type: 'test-pass', suite: 'unit', test: 'foo', score: 0.95 });
  });

  it('supports multiple subscribers', () => {
    const emitter = new EvalEventEmitter();
    const a: EvalEvent[] = [];
    const b: EvalEvent[] = [];

    emitter.subscribe((e) => a.push(e));
    emitter.subscribe((e) => b.push(e));

    emitter.emit({ type: 'test-fail', suite: 's', test: 't', score: 0, error: 'oops' });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]).toEqual(b[0]);
  });

  it('unsubscribe stops delivery', () => {
    const emitter = new EvalEventEmitter();
    const received: EvalEvent[] = [];

    const unsub = emitter.subscribe((e) => received.push(e));
    emitter.emit({ type: 'test-start', suite: 's', test: 'a' });

    unsub();
    emitter.emit({ type: 'test-start', suite: 's', test: 'b' });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('test-start');
  });

  it('tracks listener count', () => {
    const emitter = new EvalEventEmitter();

    expect(emitter.listenerCount).toBe(0);

    const unsub1 = emitter.subscribe(() => {});
    const unsub2 = emitter.subscribe(() => {});
    expect(emitter.listenerCount).toBe(2);

    unsub1();
    expect(emitter.listenerCount).toBe(1);

    unsub2();
    expect(emitter.listenerCount).toBe(0);
  });

  it('does not break if a subscriber throws', () => {
    const emitter = new EvalEventEmitter();
    const received: EvalEvent[] = [];

    emitter.subscribe(() => {
      throw new Error('bad subscriber');
    });
    emitter.subscribe((e) => received.push(e));

    emitter.emit({ type: 'suite-complete', suite: 's', passed: 3, failed: 1 });

    expect(received).toHaveLength(1);
  });

  it('handles run-complete events', () => {
    const emitter = new EvalEventEmitter();
    const received: EvalEvent[] = [];

    emitter.subscribe((e) => received.push(e));
    emitter.emit({ type: 'run-complete', runId: 'run-123', passRate: 0.85 });

    expect(received).toHaveLength(1);
    const event = received[0];
    expect(event.type).toBe('run-complete');
    if (event.type === 'run-complete') {
      expect(event.runId).toBe('run-123');
      expect(event.passRate).toBe(0.85);
    }
  });

  it('emits to no-one without error when there are no subscribers', () => {
    const emitter = new EvalEventEmitter();
    expect(() => {
      emitter.emit({ type: 'test-start', suite: 's', test: 't' });
    }).not.toThrow();
  });
});
