export type ConformanceCategory =
  | 'initialization'
  | 'tool-listing'
  | 'tool-execution'
  | 'resource-listing'
  | 'resource-reading'
  | 'prompt-listing'
  | 'prompt-getting'
  | 'error-handling'
  | 'cancellation'
  | 'capability-negotiation';

export interface ConformanceCheck {
  id: string;
  category: ConformanceCategory;
  name: string;
  description: string;
  required: boolean;
}

export interface ConformanceResult {
  check: ConformanceCheck;
  passed: boolean;
  skipped?: boolean;
  message: string;
  durationMs: number;
}

export interface ConformanceReport {
  serverName: string;
  totalChecks: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  tier: 1 | 2 | 3;
  results: ConformanceResult[];
  byCategory: Record<ConformanceCategory, { passed: number; total: number }>;
}
