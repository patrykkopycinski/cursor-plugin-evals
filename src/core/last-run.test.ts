import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { saveLastRun, loadLastFailed } from './last-run.js';
import { DATA_DIR } from './constants.js';
import type { RunResult } from './types.js';

const TMP_DIR = resolve(__dirname, '../../.test-tmp-last-run');

function makeRunResult(suites: Array<{ name: string; tests: Array<{ name: string; pass: boolean; skipped?: boolean }> }>): RunResult {
  return {
    runId: 'test-run-id',
    timestamp: '2026-03-15T00:00:00Z',
    config: 'test-plugin',
    suites: suites.map((s) => ({
      name: s.name,
      layer: 'llm' as const,
      tests: s.tests.map((t) => ({
        name: t.name,
        suite: s.name,
        layer: 'llm' as const,
        pass: t.pass,
        skipped: t.skipped,
        toolCalls: [],
        evaluatorResults: [],
        latencyMs: 100,
      })),
      passRate: 0,
      duration: 0,
      evaluatorSummary: {},
    })),
    overall: { total: 0, passed: 0, failed: 0, skipped: 0, passRate: 0, duration: 0 },
  };
}

describe('last-run', () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
    process.chdir(TMP_DIR);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  describe('saveLastRun', () => {
    it('writes failed test identifiers to last-run.json', () => {
      const result = makeRunResult([
        {
          name: 'suite-a',
          tests: [
            { name: 'test-1', pass: true },
            { name: 'test-2', pass: false },
          ],
        },
        {
          name: 'suite-b',
          tests: [
            { name: 'test-3', pass: false },
          ],
        },
      ]);

      saveLastRun(result);

      const filePath = join(TMP_DIR, DATA_DIR, 'last-run.json');
      expect(existsSync(filePath)).toBe(true);

      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(data.runId).toBe('test-run-id');
      expect(data.failed).toEqual(['suite-a/test-2', 'suite-b/test-3']);
    });

    it('excludes skipped tests from the failed list', () => {
      const result = makeRunResult([
        {
          name: 'suite-a',
          tests: [
            { name: 'test-1', pass: false, skipped: true },
            { name: 'test-2', pass: false },
          ],
        },
      ]);

      saveLastRun(result);

      const filePath = join(TMP_DIR, DATA_DIR, 'last-run.json');
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(data.failed).toEqual(['suite-a/test-2']);
    });

    it('writes empty array when all tests pass', () => {
      const result = makeRunResult([
        {
          name: 'suite-a',
          tests: [
            { name: 'test-1', pass: true },
            { name: 'test-2', pass: true },
          ],
        },
      ]);

      saveLastRun(result);

      const filePath = join(TMP_DIR, DATA_DIR, 'last-run.json');
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(data.failed).toEqual([]);
    });

    it('creates the state directory if it does not exist', () => {
      const dir = join(TMP_DIR, DATA_DIR);
      expect(existsSync(dir)).toBe(false);

      saveLastRun(makeRunResult([]));

      expect(existsSync(dir)).toBe(true);
    });
  });

  describe('loadLastFailed', () => {
    it('returns the failed list from a saved run', () => {
      const result = makeRunResult([
        {
          name: 'suite-x',
          tests: [
            { name: 'failing', pass: false },
            { name: 'passing', pass: true },
          ],
        },
      ]);

      saveLastRun(result);
      const failed = loadLastFailed();
      expect(failed).toEqual(['suite-x/failing']);
    });

    it('returns empty array when no last-run file exists', () => {
      const failed = loadLastFailed();
      expect(failed).toEqual([]);
    });

    it('returns empty array when file contains invalid JSON', () => {
      const dir = join(TMP_DIR, DATA_DIR);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'last-run.json'), 'not-json', 'utf-8');

      const failed = loadLastFailed();
      expect(failed).toEqual([]);
    });
  });
});
