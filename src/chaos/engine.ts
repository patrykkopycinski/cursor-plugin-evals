import type { FaultRule, FaultKind, ChaosConfig, ChaosEvent, ChaosReport } from './types.js';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INTENSITY_MAP: Record<string, number> = { low: 0.05, medium: 0.2, high: 0.5 };

const DEFAULT_NETWORK_FAULTS: FaultKind[] = ['timeout', 'drop', 'disconnect', 'slow_drain'];
const DEFAULT_PROTOCOL_FAULTS: FaultKind[] = ['corrupt', 'error_response', 'reorder', 'duplicate'];

export class ChaosEngine {
  private rules: FaultRule[];
  private random: () => number;
  private events: ChaosEvent[] = [];
  private totalRequests = 0;
  private survivedCount = 0;
  private crashedCount = 0;

  constructor(config: ChaosConfig) {
    this.random = mulberry32(config.seed ?? Date.now());

    if (config.rules && config.rules.length > 0) {
      this.rules = config.rules;
    } else {
      const prob = INTENSITY_MAP[config.intensity ?? 'medium'] ?? 0.2;
      const kinds: FaultKind[] = [];
      if (config.network !== false) kinds.push(...DEFAULT_NETWORK_FAULTS);
      if (config.protocol !== false) kinds.push(...DEFAULT_PROTOCOL_FAULTS);
      this.rules = kinds.map((kind) => ({ kind, probability: prob }));
    }
  }

  shouldFault(toolName: string): FaultRule | null {
    for (const rule of this.rules) {
      if (rule.tools && !rule.tools.includes(toolName)) continue;
      if (this.random() < rule.probability) return rule;
    }
    return null;
  }

  recordRequest(tool: string, fault: FaultRule | null, survived: boolean): void {
    this.totalRequests++;
    if (fault) {
      this.events.push({
        timestamp: Date.now(),
        tool,
        fault: fault.kind,
        details: `Injected ${fault.kind} fault (p=${fault.probability})`,
      });
      if (survived) this.survivedCount++;
      else this.crashedCount++;
    } else {
      this.survivedCount++;
    }
  }

  getReport(): ChaosReport {
    const faultsByKind: Record<string, number> = {};
    for (const e of this.events) {
      faultsByKind[e.fault] = (faultsByKind[e.fault] ?? 0) + 1;
    }
    return {
      totalRequests: this.totalRequests,
      faultsInjected: this.events.length,
      faultsByKind,
      events: [...this.events],
      survivedCount: this.survivedCount,
      crashedCount: this.crashedCount,
      survivalRate: this.totalRequests > 0 ? this.survivedCount / this.totalRequests : 1,
    };
  }

  getRules(): FaultRule[] {
    return [...this.rules];
  }
}
