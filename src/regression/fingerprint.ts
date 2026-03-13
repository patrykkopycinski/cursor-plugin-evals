import { writeFile, readFile, readdir, mkdir } from 'fs/promises';
import { resolve } from 'path';
import type { TestResult } from '../core/types.js';

export interface Fingerprint {
  runId: string;
  timestamp: string;
  scores: Record<string, number[]>;
}

const DEFAULT_DIR = '.cursor-plugin-evals/fingerprints';

function resolveDir(dir?: string): string {
  return resolve(process.cwd(), dir ?? DEFAULT_DIR);
}

/**
 * Builds a fingerprint from test results.
 * Keys are `suite.test.evaluator` to uniquely identify each metric.
 */
export function buildFingerprint(runId: string, results: TestResult[]): Fingerprint {
  const scores: Record<string, number[]> = {};

  for (const test of results) {
    for (const er of test.evaluatorResults) {
      const key = `${test.suite}.${test.name}.${er.evaluator}`;
      const arr = scores[key];
      if (arr) {
        arr.push(er.score);
      } else {
        scores[key] = [er.score];
      }
    }
  }

  return {
    runId,
    timestamp: new Date().toISOString(),
    scores,
  };
}

export async function saveFingerprint(fp: Fingerprint, dir?: string): Promise<void> {
  const fpDir = resolveDir(dir);
  await mkdir(fpDir, { recursive: true });
  const filePath = resolve(fpDir, `${fp.runId}.json`);
  await writeFile(filePath, JSON.stringify(fp, null, 2), 'utf-8');
}

export async function loadFingerprint(runId: string, dir?: string): Promise<Fingerprint | null> {
  const fpDir = resolveDir(dir);
  const filePath = resolve(fpDir, `${runId}.json`);
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as Fingerprint;
  } catch {
    return null;
  }
}

export async function listFingerprints(dir?: string): Promise<string[]> {
  const fpDir = resolveDir(dir);
  try {
    const files = await readdir(fpDir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}
