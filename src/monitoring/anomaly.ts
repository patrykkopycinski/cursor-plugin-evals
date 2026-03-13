export interface AnomalyDetector {
  addScore(metric: string, value: number): void;
  isAnomaly(metric: string, value: number): boolean;
  getStats(metric: string): { mean: number; stddev: number; count: number } | null;
}

interface MetricWindow {
  values: number[];
  sum: number;
  sumSq: number;
}

export function createAnomalyDetector(
  windowSize: number = 100,
  zThreshold: number = 2.0,
): AnomalyDetector {
  const windows = new Map<string, MetricWindow>();

  function getOrCreate(metric: string): MetricWindow {
    let w = windows.get(metric);
    if (!w) {
      w = { values: [], sum: 0, sumSq: 0 };
      windows.set(metric, w);
    }
    return w;
  }

  function computeStats(w: MetricWindow): { mean: number; stddev: number } {
    const n = w.values.length;
    if (n === 0) return { mean: 0, stddev: 0 };
    const mean = w.sum / n;
    const variance = w.sumSq / n - mean * mean;
    return { mean, stddev: Math.sqrt(Math.max(0, variance)) };
  }

  return {
    addScore(metric: string, value: number): void {
      const w = getOrCreate(metric);

      if (w.values.length >= windowSize) {
        const evicted = w.values.shift()!;
        w.sum -= evicted;
        w.sumSq -= evicted * evicted;
      }

      w.values.push(value);
      w.sum += value;
      w.sumSq += value * value;
    },

    isAnomaly(metric: string, value: number): boolean {
      const w = windows.get(metric);
      if (!w || w.values.length < 2) return false;

      const { mean, stddev } = computeStats(w);
      if (stddev === 0) return value !== mean;

      const z = Math.abs(value - mean) / stddev;
      return z > zThreshold;
    },

    getStats(metric: string): { mean: number; stddev: number; count: number } | null {
      const w = windows.get(metric);
      if (!w || w.values.length === 0) return null;

      const { mean, stddev } = computeStats(w);
      return { mean, stddev, count: w.values.length };
    },
  };
}
