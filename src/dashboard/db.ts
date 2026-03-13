import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { RunResult, SuiteResult } from '../core/types.js';

export interface StoredRun {
  id: string;
  timestamp: string;
  config: string;
  overall_json: string;
}

export interface StoredSuiteResult {
  id: string;
  run_id: string;
  name: string;
  layer: string;
  pass_rate: number;
  duration: number;
  results_json: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    config TEXT NOT NULL,
    overall_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS suite_results (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    name TEXT NOT NULL,
    layer TEXT NOT NULL,
    pass_rate REAL NOT NULL,
    duration REAL NOT NULL,
    results_json TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
  );

  CREATE INDEX IF NOT EXISTS idx_suite_results_run_id ON suite_results(run_id);
  CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON runs(timestamp);
`;

export function initDb(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function initMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
}

export function saveRun(db: Database.Database, result: RunResult): string {
  const id = result.runId;

  const overallJson = JSON.stringify({
    ...result.overall,
    qualityScore: result.qualityScore,
    confidenceIntervals: result.confidenceIntervals,
  });

  const insertRun = db.prepare(
    'INSERT INTO runs (id, timestamp, config, overall_json) VALUES (?, ?, ?, ?)',
  );
  const insertSuite = db.prepare(
    'INSERT INTO suite_results (id, run_id, name, layer, pass_rate, duration, results_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  const tx = db.transaction(() => {
    insertRun.run(id, result.timestamp, result.config, overallJson);

    for (const suite of result.suites) {
      const suiteId = randomUUID();
      const suiteJson = JSON.stringify({
        tests: suite.tests,
        evaluatorSummary: suite.evaluatorSummary,
      });
      insertSuite.run(
        suiteId,
        id,
        suite.name,
        suite.layer,
        suite.passRate,
        suite.duration,
        suiteJson,
      );
    }
  });

  tx();
  return id;
}

export function getRuns(db: Database.Database): StoredRun[] {
  return db.prepare('SELECT * FROM runs ORDER BY timestamp DESC').all() as StoredRun[];
}

export function getRun(
  db: Database.Database,
  id: string,
): { run: StoredRun; suites: StoredSuiteResult[] } | null {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as StoredRun | undefined;
  if (!run) return null;

  const suites = db
    .prepare('SELECT * FROM suite_results WHERE run_id = ? ORDER BY name')
    .all(id) as StoredSuiteResult[];

  return { run, suites };
}

export function getLatestRuns(db: Database.Database, limit: number): StoredRun[] {
  return db.prepare('SELECT * FROM runs ORDER BY timestamp DESC LIMIT ?').all(limit) as StoredRun[];
}
