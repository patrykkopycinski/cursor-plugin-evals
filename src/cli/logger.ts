import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let currentLevel: LogLevel = 'info';
let noColor = false;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setNoColor(value: boolean): void {
  noColor = value;
}

function c(fn: (s: string) => string, text: string): string {
  return noColor ? text : fn(text);
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

export const log = {
  debug(...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.log(c(chalk.gray, '  [debug]'), ...args);
    }
  },

  info(...args: unknown[]): void {
    if (shouldLog('info')) {
      console.log(...args);
    }
  },

  success(message: string): void {
    if (shouldLog('info')) {
      console.log(c(chalk.green, '  ✓'), message);
    }
  },

  warn(message: string): void {
    if (shouldLog('warn')) {
      console.warn(c(chalk.yellow, '  ⚠'), message);
    }
  },

  error(message: string, error?: unknown): void {
    if (shouldLog('error')) {
      console.error(c(chalk.red, '  ✗'), message);
      if (error instanceof Error && currentLevel === 'debug') {
        console.error(c(chalk.gray, error.stack ?? error.message));
      }
    }
  },

  header(title: string): void {
    if (shouldLog('info')) {
      console.log();
      console.log(c(chalk.bold, `━━━ ${title} ━━━`));
      console.log();
    }
  },

  suite(name: string, layer: string): void {
    if (shouldLog('info')) {
      console.log(c(chalk.cyan, `  ● ${name}`), c(chalk.gray, `[${layer}]`));
    }
  },

  test(name: string, status: 'pass' | 'fail' | 'skip' | 'running'): void {
    if (!shouldLog('info')) return;
    const icons: Record<string, string> = {
      pass: c(chalk.green, '✓'),
      fail: c(chalk.red, '✗'),
      skip: c(chalk.yellow, '○'),
      running: c(chalk.blue, '↻'),
    };
    console.log(`    ${icons[status]} ${name}`);
  },

  evaluator(name: string, score: number, pass: boolean): void {
    if (!shouldLog('info')) return;
    const scoreStr = score.toFixed(2);
    const icon = pass ? c(chalk.green, '✓') : c(chalk.red, '✗');
    const scoreColor = pass ? chalk.green : chalk.red;
    console.log(`      ${icon} ${name}: ${c(scoreColor, scoreStr)}`);
  },

  table(rows: string[][]): void {
    if (!shouldLog('info')) return;
    if (rows.length === 0) return;
    const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
    for (const row of rows) {
      const line = row.map((cell, i) => cell.padEnd(widths[i])).join('  ');
      console.log(`    ${line}`);
    }
  },

  divider(): void {
    if (shouldLog('info')) {
      console.log(c(chalk.gray, '  ────────────────────────────────────────'));
    }
  },

  summary(total: number, passed: number, failed: number, duration: number, skipped?: number): void {
    if (!shouldLog('info')) return;
    console.log();
    log.divider();
    const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
    const color = failed === 0 ? chalk.green : chalk.red;
    const parts = [`${passed} passed`, `${failed} failed`];
    if (skipped && skipped > 0) parts.push(`${skipped} skipped`);
    console.log(
      `  ${c(color, `${rate}% pass rate`)} — ${parts.join(', ')}, ${total} total (${(duration / 1000).toFixed(1)}s)`,
    );
    console.log();
  },
};
