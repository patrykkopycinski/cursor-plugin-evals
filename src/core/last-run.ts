import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RunResult } from './types.js';
import { DATA_DIR } from './constants.js';
const LAST_RUN_FILE = 'last-run.json';

interface LastRunData {
  timestamp: string;
  runId: string;
  failed: string[];
}

function lastRunPath(): string {
  return resolve(process.cwd(), DATA_DIR, LAST_RUN_FILE);
}

export function saveLastRun(result: RunResult): void {
  const failed: string[] = [];

  for (const suite of result.suites) {
    for (const test of suite.tests) {
      if (!test.pass && !test.skipped) {
        failed.push(`${suite.name}/${test.name}`);
      }
    }
  }

  const data: LastRunData = {
    timestamp: result.timestamp,
    runId: result.runId,
    failed,
  };

  const filePath = lastRunPath();
  mkdirSync(resolve(process.cwd(), DATA_DIR), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function loadLastFailed(): string[] {
  try {
    const raw = readFileSync(lastRunPath(), 'utf-8');
    const data: LastRunData = JSON.parse(raw);
    return data.failed ?? [];
  } catch (_e) {
    return [];
  }
}
