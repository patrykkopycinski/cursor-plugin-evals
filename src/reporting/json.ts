import type { RunResult } from '../core/types.js';

export function generateJsonReport(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}
