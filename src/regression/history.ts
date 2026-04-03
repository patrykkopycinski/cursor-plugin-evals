import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, resolve } from 'node:path';
import type { RunResult } from '../core/types.js';
import { DATA_DIR } from '../core/constants.js';

export interface HistoryEntry {
  runId: string;
  timestamp: string;
  config: string;
  overall: {
    passRate: number;
    total: number;
    passed: number;
    failed: number;
    duration: number;
  };
  suites: Record<string, {
    passRate: number;
    evaluators: Record<string, number>;
  }>;
}

export interface ScoreHistory {
  entries: HistoryEntry[];
}

const DEFAULT_PATH = join(DATA_DIR, 'score-history.json');

function resolvePath(path?: string): string {
  return resolve(process.cwd(), path ?? DEFAULT_PATH);
}

export async function loadHistory(path?: string): Promise<ScoreHistory> {
  try {
    const raw = await readFile(resolvePath(path), 'utf-8');
    return JSON.parse(raw) as ScoreHistory;
  } catch (_e) {
    return { entries: [] };
  }
}

export async function appendHistory(
  run: RunResult,
  path?: string,
): Promise<HistoryEntry> {
  const history = await loadHistory(path);

  const suites: HistoryEntry['suites'] = {};
  for (const suite of run.suites) {
    const evaluators: Record<string, number> = {};
    for (const [name, summary] of Object.entries(suite.evaluatorSummary)) {
      evaluators[name] = summary.mean;
    }
    suites[suite.name] = {
      passRate: suite.passRate,
      evaluators,
    };
  }

  const entry: HistoryEntry = {
    runId: run.runId,
    timestamp: run.timestamp,
    config: run.config,
    overall: {
      passRate: run.overall.passRate,
      total: run.overall.total,
      passed: run.overall.passed,
      failed: run.overall.failed,
      duration: run.overall.duration,
    },
    suites,
  };

  history.entries.push(entry);

  if (history.entries.length > 50) {
    history.entries = history.entries.slice(-50);
  }

  const filePath = resolvePath(path);
  await mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');

  return entry;
}

/**
 * Compare the latest entry against the previous N entries to detect trends.
 * Returns a summary string suitable for CLI output.
 */
export function summarizeTrend(history: ScoreHistory, windowSize = 5): string {
  if (history.entries.length < 2) return 'Not enough data for trend analysis.';

  const recent = history.entries.slice(-1)[0];
  const previous = history.entries.slice(-(windowSize + 1), -1);

  if (previous.length === 0) return 'Not enough data for trend analysis.';

  const avgPrevPassRate = previous.reduce((s, e) => s + e.overall.passRate, 0) / previous.length;
  const delta = recent.overall.passRate - avgPrevPassRate;
  const direction = delta > 0.02 ? '↑' : delta < -0.02 ? '↓' : '→';
  const pct = (delta * 100).toFixed(1);

  const lines: string[] = [
    `Trend (last ${previous.length} runs): ${direction} ${pct}%`,
    `  Current: ${(recent.overall.passRate * 100).toFixed(1)}% pass rate (${recent.overall.passed}/${recent.overall.total})`,
    `  Average: ${(avgPrevPassRate * 100).toFixed(1)}% pass rate`,
  ];

  for (const [suiteName, suiteData] of Object.entries(recent.suites)) {
    const prevRates = previous
      .map((e) => e.suites[suiteName]?.passRate)
      .filter((r): r is number => r !== undefined);
    if (prevRates.length === 0) continue;
    const avgPrev = prevRates.reduce((s, r) => s + r, 0) / prevRates.length;
    const suiteDelta = suiteData.passRate - avgPrev;
    if (Math.abs(suiteDelta) > 0.05) {
      const dir = suiteDelta > 0 ? '↑' : '↓';
      lines.push(`  ${dir} ${suiteName}: ${(suiteDelta * 100).toFixed(1)}%`);
    }
  }

  return lines.join('\n');
}
