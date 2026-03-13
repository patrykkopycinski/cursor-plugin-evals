import { describe, it, expect } from 'vitest';
import { createAnomalyDetector } from './anomaly.js';

describe('createAnomalyDetector', () => {
  it('returns null stats for unknown metric', () => {
    const detector = createAnomalyDetector();
    expect(detector.getStats('unknown')).toBeNull();
  });

  it('tracks mean and stddev correctly', () => {
    const detector = createAnomalyDetector(100);

    for (const v of [10, 20, 30, 40, 50]) {
      detector.addScore('latency', v);
    }

    const stats = detector.getStats('latency');
    expect(stats).not.toBeNull();
    expect(stats!.mean).toBeCloseTo(30);
    expect(stats!.count).toBe(5);
    expect(stats!.stddev).toBeCloseTo(Math.sqrt(200), 5);
  });

  it('does not flag anomaly with fewer than 2 samples', () => {
    const detector = createAnomalyDetector(100, 2.0);
    detector.addScore('score', 0.5);
    expect(detector.isAnomaly('score', 100)).toBe(false);
  });

  it('does not flag values within threshold', () => {
    const detector = createAnomalyDetector(100, 2.0);

    for (let i = 0; i < 50; i++) {
      detector.addScore('score', 100);
    }

    expect(detector.isAnomaly('score', 100)).toBe(false);
  });

  it('flags extreme outliers as anomalies', () => {
    const detector = createAnomalyDetector(100, 2.0);

    for (let i = 0; i < 50; i++) {
      detector.addScore('latency', 100 + (i % 2 === 0 ? 1 : -1));
    }

    expect(detector.isAnomaly('latency', 500)).toBe(true);
    expect(detector.isAnomaly('latency', 100)).toBe(false);
  });

  it('respects custom z-score threshold', () => {
    const detector = createAnomalyDetector(100, 1.0);

    for (let i = 0; i < 20; i++) {
      detector.addScore('m', 10);
    }
    detector.addScore('m', 12);

    const stats = detector.getStats('m')!;
    const z = Math.abs(15 - stats.mean) / stats.stddev;
    expect(z).toBeGreaterThan(1.0);
    expect(detector.isAnomaly('m', 15)).toBe(true);
  });

  it('evicts old values when window overflows', () => {
    const detector = createAnomalyDetector(5);

    for (let i = 1; i <= 5; i++) {
      detector.addScore('x', 10);
    }
    expect(detector.getStats('x')!.count).toBe(5);

    detector.addScore('x', 50);
    expect(detector.getStats('x')!.count).toBe(5);
    expect(detector.getStats('x')!.mean).toBe(18);
  });

  it('detects anomaly when stddev is zero but value differs', () => {
    const detector = createAnomalyDetector(100, 2.0);

    for (let i = 0; i < 10; i++) {
      detector.addScore('const', 42);
    }

    expect(detector.isAnomaly('const', 42)).toBe(false);
    expect(detector.isAnomaly('const', 43)).toBe(true);
  });

  it('handles multiple independent metrics', () => {
    const detector = createAnomalyDetector(100, 2.0);

    for (let i = 0; i < 20; i++) {
      detector.addScore('a', 100);
      detector.addScore('b', 200);
    }

    expect(detector.getStats('a')!.mean).toBeCloseTo(100);
    expect(detector.getStats('b')!.mean).toBeCloseTo(200);
  });
});
