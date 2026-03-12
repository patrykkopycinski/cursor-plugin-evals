import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initMemoryDb, saveRun, getRuns, getRun, getLatestRuns } from './db.js';
import type { RunResult } from '../core/types.js';

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runId: overrides.runId ?? 'test-run-1',
    timestamp: overrides.timestamp ?? '2025-01-15T10:30:00.000Z',
    config: overrides.config ?? 'test-plugin',
    suites: overrides.suites ?? [
      {
        name: 'unit-basics',
        layer: 'unit',
        tests: [
          {
            name: 'registration',
            suite: 'unit-basics',
            layer: 'unit',
            pass: true,
            toolCalls: [],
            evaluatorResults: [],
            latencyMs: 42,
          },
          {
            name: 'schema-check',
            suite: 'unit-basics',
            layer: 'unit',
            pass: false,
            toolCalls: [],
            evaluatorResults: [],
            latencyMs: 15,
            error: 'Schema mismatch',
          },
        ],
        passRate: 0.5,
        duration: 57,
        evaluatorSummary: {},
      },
    ],
    overall: overrides.overall ?? {
      total: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
      duration: 57,
    },
    qualityScore: overrides.qualityScore ?? {
      dimensions: { correctness: 0.5 },
      composite: 50,
      grade: 'C',
      weights: { correctness: 1 },
    },
  };
}

describe('dashboard db', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initMemoryDb();
  });

  describe('initDb', () => {
    it('creates runs table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runs'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('creates suite_results table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='suite_results'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('creates indexes', () => {
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all() as Array<{ name: string }>;
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_suite_results_run_id');
      expect(names).toContain('idx_runs_timestamp');
    });
  });

  describe('saveRun + getRuns round-trip', () => {
    it('saves and retrieves a run', () => {
      const result = makeRunResult();
      saveRun(db, result);

      const runs = getRuns(db);
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe('test-run-1');
      expect(runs[0].config).toBe('test-plugin');
      expect(runs[0].timestamp).toBe('2025-01-15T10:30:00.000Z');

      const overall = JSON.parse(runs[0].overall_json);
      expect(overall.total).toBe(2);
      expect(overall.passed).toBe(1);
      expect(overall.passRate).toBe(0.5);
      expect(overall.qualityScore.grade).toBe('C');
    });

    it('saves suite results alongside the run', () => {
      const result = makeRunResult();
      const id = saveRun(db, result);

      const data = getRun(db, id);
      expect(data).not.toBeNull();
      expect(data!.suites).toHaveLength(1);
      expect(data!.suites[0].name).toBe('unit-basics');
      expect(data!.suites[0].layer).toBe('unit');
      expect(data!.suites[0].pass_rate).toBe(0.5);

      const details = JSON.parse(data!.suites[0].results_json);
      expect(details.tests).toHaveLength(2);
      expect(details.tests[0].name).toBe('registration');
      expect(details.tests[1].pass).toBe(false);
    });

    it('handles multiple runs', () => {
      saveRun(db, makeRunResult({ runId: 'run-a', timestamp: '2025-01-15T10:00:00.000Z' }));
      saveRun(db, makeRunResult({ runId: 'run-b', timestamp: '2025-01-15T11:00:00.000Z' }));
      saveRun(db, makeRunResult({ runId: 'run-c', timestamp: '2025-01-15T12:00:00.000Z' }));

      const runs = getRuns(db);
      expect(runs).toHaveLength(3);
      expect(runs[0].id).toBe('run-c');
      expect(runs[2].id).toBe('run-a');
    });
  });

  describe('getRun', () => {
    it('returns correct data for a specific run', () => {
      saveRun(db, makeRunResult({ runId: 'run-x', config: 'special-plugin' }));
      saveRun(db, makeRunResult({ runId: 'run-y', config: 'other-plugin' }));

      const data = getRun(db, 'run-x');
      expect(data).not.toBeNull();
      expect(data!.run.config).toBe('special-plugin');
    });

    it('returns null for non-existent run', () => {
      const data = getRun(db, 'does-not-exist');
      expect(data).toBeNull();
    });
  });

  describe('getLatestRuns', () => {
    it('returns limited number of runs', () => {
      for (let i = 0; i < 10; i++) {
        saveRun(db, makeRunResult({
          runId: `run-${i}`,
          timestamp: `2025-01-15T${String(i).padStart(2, '0')}:00:00.000Z`,
        }));
      }

      const latest = getLatestRuns(db, 3);
      expect(latest).toHaveLength(3);
      expect(latest[0].id).toBe('run-9');
      expect(latest[1].id).toBe('run-8');
      expect(latest[2].id).toBe('run-7');
    });

    it('returns all runs when limit exceeds count', () => {
      saveRun(db, makeRunResult({ runId: 'only-run' }));
      const latest = getLatestRuns(db, 100);
      expect(latest).toHaveLength(1);
    });
  });
});
