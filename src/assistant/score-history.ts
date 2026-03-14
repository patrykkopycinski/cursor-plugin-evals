import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { RunResult } from '../core/types.js';
import type { ScoreSnapshot, DriftAlert } from './types.js';

const DB_DIR = '.cursor-plugin-evals';
const DB_NAME = 'score-history.db';

function openDb(rootDir: string): Database.Database {
  const dbPath = join(rootDir, DB_DIR, DB_NAME);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      run_id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      overall_pass_rate REAL NOT NULL,
      quality_score REAL NOT NULL,
      grade TEXT NOT NULL,
      suite_scores TEXT NOT NULL,
      evaluator_means TEXT NOT NULL,
      total_tests INTEGER NOT NULL,
      total_passed INTEGER NOT NULL
    )
  `);

  return db;
}

export async function ensureDbDir(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, DB_DIR), { recursive: true });
}

export function recordSnapshot(rootDir: string, result: RunResult): ScoreSnapshot {
  const suiteScores: Record<string, number> = {};
  const evaluatorSums: Record<string, { total: number; count: number }> = {};

  for (const suite of result.suites) {
    suiteScores[suite.name] = suite.passRate;
    for (const [evalName, stats] of Object.entries(suite.evaluatorSummary)) {
      const existing = evaluatorSums[evalName] ?? { total: 0, count: 0 };
      existing.total += stats.mean * stats.total;
      existing.count += stats.total;
      evaluatorSums[evalName] = existing;
    }
  }

  const evaluatorMeans: Record<string, number> = {};
  for (const [name, { total, count }] of Object.entries(evaluatorSums)) {
    evaluatorMeans[name] = count > 0 ? total / count : 0;
  }

  const snapshot: ScoreSnapshot = {
    runId: result.runId,
    timestamp: result.timestamp,
    overallPassRate: result.overall.passRate,
    qualityScore: result.qualityScore?.composite ?? 0,
    grade: result.qualityScore?.grade ?? 'N/A',
    suiteScores,
    evaluatorMeans,
    totalTests: result.overall.total,
    totalPassed: result.overall.passed,
  };

  const db = openDb(rootDir);
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO snapshots
        (run_id, timestamp, overall_pass_rate, quality_score, grade,
         suite_scores, evaluator_means, total_tests, total_passed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      snapshot.runId,
      snapshot.timestamp,
      snapshot.overallPassRate,
      snapshot.qualityScore,
      snapshot.grade,
      JSON.stringify(snapshot.suiteScores),
      JSON.stringify(snapshot.evaluatorMeans),
      snapshot.totalTests,
      snapshot.totalPassed,
    );
  } finally {
    db.close();
  }

  return snapshot;
}

export function getHistory(rootDir: string, limit = 50): ScoreSnapshot[] {
  const db = openDb(rootDir);
  try {
    const rows = db.prepare(
      'SELECT * FROM snapshots ORDER BY timestamp DESC LIMIT ?',
    ).all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      runId: row.run_id as string,
      timestamp: row.timestamp as string,
      overallPassRate: row.overall_pass_rate as number,
      qualityScore: row.quality_score as number,
      grade: row.grade as string,
      suiteScores: JSON.parse(row.suite_scores as string),
      evaluatorMeans: JSON.parse(row.evaluator_means as string),
      totalTests: row.total_tests as number,
      totalPassed: row.total_passed as number,
    }));
  } finally {
    db.close();
  }
}

export function detectDrift(rootDir: string, windowSize = 5): DriftAlert[] {
  const history = getHistory(rootDir, windowSize + 5);
  if (history.length < windowSize) return [];

  const alerts: DriftAlert[] = [];
  const recent = history.slice(0, windowSize);

  const passRates = recent.map((s) => s.overallPassRate);
  const slope = computeSlope(passRates);

  if (slope < -0.02) {
    alerts.push({
      metric: 'overall_pass_rate',
      direction: 'degrading',
      recentTrend: passRates,
      slope,
      severity: slope < -0.05 ? 'high' : 'medium',
      message: `Pass rate declining at ${(slope * 100).toFixed(1)}% per run over last ${windowSize} runs`,
    });
  }

  const qualityScores = recent.map((s) => s.qualityScore);
  const qSlope = computeSlope(qualityScores);

  if (qSlope < -1) {
    alerts.push({
      metric: 'quality_score',
      direction: 'degrading',
      recentTrend: qualityScores,
      slope: qSlope,
      severity: qSlope < -3 ? 'high' : 'medium',
      message: `Quality score declining at ${qSlope.toFixed(1)} points per run over last ${windowSize} runs`,
    });
  }

  if (slope > 0.02) {
    alerts.push({
      metric: 'overall_pass_rate',
      direction: 'improving',
      recentTrend: passRates,
      slope,
      severity: 'info',
      message: `Pass rate improving at ${(slope * 100).toFixed(1)}% per run`,
    });
  }

  return alerts;
}

function computeSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = n - 1 - i;
    sumX += x;
    sumY += values[i];
    sumXY += x * values[i];
    sumXX += x * x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function formatHistoryReport(snapshots: ScoreSnapshot[], alerts: DriftAlert[]): string {
  const lines: string[] = [];
  lines.push('# Score History');
  lines.push('');

  if (alerts.length > 0) {
    lines.push('## Drift Alerts');
    for (const a of alerts) {
      const icon = a.direction === 'degrading' ? '!!!' : 'i';
      lines.push(`- [${icon}] ${a.message}`);
    }
    lines.push('');
  }

  lines.push('## Recent Runs');
  lines.push('| Run | Date | Pass Rate | Quality | Grade | Tests |');
  lines.push('|-----|------|-----------|---------|-------|-------|');
  for (const s of snapshots.slice(0, 10)) {
    const date = s.timestamp.split('T')[0];
    lines.push(`| ${s.runId.slice(0, 8)} | ${date} | ${Math.round(s.overallPassRate * 100)}% | ${s.qualityScore.toFixed(0)} | ${s.grade} | ${s.totalPassed}/${s.totalTests} |`);
  }

  return lines.join('\n');
}
