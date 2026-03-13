export type {
  ConformanceCategory,
  ConformanceCheck,
  ConformanceResult,
  ConformanceReport,
} from './types.js';
export { ALL_CHECKS, CHECKS_BY_CATEGORY } from './checks.js';
export { runConformanceChecks, computeTier } from './runner.js';
export type { ConformanceOptions } from './runner.js';
export { formatConformanceReport } from './report.js';
