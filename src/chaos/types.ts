export type FaultKind =
  | 'timeout'
  | 'drop'
  | 'corrupt'
  | 'error_response'
  | 'disconnect'
  | 'slow_drain'
  | 'reorder'
  | 'duplicate';

export interface FaultRule {
  kind: FaultKind;
  /** Probability 0-1 that this fault fires per request */
  probability: number;
  /** Only apply to these tool names (undefined = all) */
  tools?: string[];
  /** For timeout/slow_drain: delay in ms */
  delayMs?: number;
  /** For corrupt: number of bytes to garble */
  corruptBytes?: number;
}

export interface ChaosConfig {
  /** Intensity preset: low (5%), medium (20%), high (50%) */
  intensity?: 'low' | 'medium' | 'high';
  /** Custom fault rules (override intensity) */
  rules?: FaultRule[];
  /** Seed for deterministic randomness */
  seed?: number;
  /** Network-level faults */
  network?: boolean;
  /** Protocol-level faults */
  protocol?: boolean;
}

export interface ChaosEvent {
  timestamp: number;
  tool: string;
  fault: FaultKind;
  details: string;
}

export interface ChaosReport {
  totalRequests: number;
  faultsInjected: number;
  faultsByKind: Record<string, number>;
  events: ChaosEvent[];
  survivedCount: number;
  crashedCount: number;
  survivalRate: number;
}
