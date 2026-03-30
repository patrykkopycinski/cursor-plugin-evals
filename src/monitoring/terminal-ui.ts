import type { LiveScoreResult } from './live-scorer.js';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
} as const;

export interface TerminalUIConfig {
  showDetails?: boolean;
  compact?: boolean;
  colorThreshold?: { warn: number; fail: number };
}

function scoreColor(
  score: number,
  thresholds: { warn: number; fail: number },
): string {
  if (score >= thresholds.warn) return C.green;
  if (score >= thresholds.fail) return C.yellow;
  return C.red;
}

function formatScore(score: number, thresholds: { warn: number; fail: number }): string {
  const color = scoreColor(score, thresholds);
  const pct = (score * 100).toFixed(1);
  return `${color}${pct}%${C.reset}`;
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

function padRight(str: string, len: number): string {
  // Strip ANSI codes for length calculation
  const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - plain.length);
  return str + ' '.repeat(pad);
}

function formatLatency(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${ms}ms`;
}

export class TerminalUI {
  private readonly config: Required<TerminalUIConfig>;

  constructor(config: TerminalUIConfig = {}) {
    this.config = {
      showDetails: config.showDetails ?? false,
      compact: config.compact ?? false,
      colorThreshold: config.colorThreshold ?? { warn: 0.7, fail: 0.5 },
    };
  }

  renderHeader(config: { evaluators: string[]; mode: string; port?: number }): void {
    const line = '─'.repeat(60);
    process.stdout.write(`\n${C.bold}${C.cyan}┌${line}┐${C.reset}\n`);
    process.stdout.write(
      `${C.bold}${C.cyan}│${C.reset}  ${C.bold}cursor-plugin-evals${C.reset} ${C.dim}live monitor${C.reset}${' '.repeat(38)}${C.bold}${C.cyan}│${C.reset}\n`,
    );
    process.stdout.write(`${C.bold}${C.cyan}├${line}┤${C.reset}\n`);
    process.stdout.write(
      `${C.bold}${C.cyan}│${C.reset}  ${C.dim}Mode:${C.reset}       ${config.mode}${' '.repeat(Math.max(0, 52 - config.mode.length))}${C.bold}${C.cyan}│${C.reset}\n`,
    );
    const evalStr = config.evaluators.join(', ');
    const evalDisplay = evalStr.length > 50 ? evalStr.slice(0, 47) + '...' : evalStr;
    process.stdout.write(
      `${C.bold}${C.cyan}│${C.reset}  ${C.dim}Evaluators:${C.reset} ${evalDisplay}${' '.repeat(Math.max(0, 46 - evalDisplay.length))}${C.bold}${C.cyan}│${C.reset}\n`,
    );
    if (config.port) {
      const portStr = `http://localhost:${config.port}/v1/traces`;
      process.stdout.write(
        `${C.bold}${C.cyan}│${C.reset}  ${C.dim}OTLP:${C.reset}       ${portStr}${' '.repeat(Math.max(0, 52 - portStr.length))}${C.bold}${C.cyan}│${C.reset}\n`,
      );
    }
    process.stdout.write(`${C.bold}${C.cyan}└${line}┘${C.reset}\n\n`);
  }

  renderScore(result: LiveScoreResult): void {
    const { colorThreshold } = this.config;
    const statusIcon = result.pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    const anomalyBadge = result.anomaly ? ` ${C.bgRed}${C.white} ANOMALY ${C.reset}` : '';
    const scoreStr = formatScore(result.overallScore, colorThreshold);
    const latency = formatLatency(result.latencyMs);
    const traceShort = shortId(result.traceId);

    if (this.config.compact) {
      const tools =
        result.toolsCalled.length > 0
          ? ` ${C.dim}[${result.toolsCalled.slice(0, 3).join(', ')}${result.toolsCalled.length > 3 ? `+${result.toolsCalled.length - 3}` : ''}]${C.reset}`
          : '';
      process.stdout.write(
        `${statusIcon} ${C.dim}${traceShort}${C.reset} ${scoreStr} ${C.dim}${latency}${C.reset}${tools}${anomalyBadge}\n`,
      );
      return;
    }

    // Standard output
    process.stdout.write(
      `${statusIcon} ${C.bold}${traceShort}${C.reset}  score: ${scoreStr}  latency: ${C.cyan}${latency}${C.reset}${anomalyBadge}\n`,
    );

    if (result.toolsCalled.length > 0) {
      process.stdout.write(
        `  ${C.dim}tools:${C.reset} ${result.toolsCalled.join(', ')}\n`,
      );
    }

    if (this.config.showDetails && Object.keys(result.scores).length > 0) {
      process.stdout.write(`  ${C.dim}┌─ evaluators ─────────────────────────────┐${C.reset}\n`);
      for (const [name, score] of Object.entries(result.scores)) {
        const bar = this.renderBar(score, 20);
        const namePadded = padRight(name, 24);
        process.stdout.write(
          `  ${C.dim}│${C.reset} ${namePadded} ${bar} ${formatScore(score, colorThreshold)}\n`,
        );
      }
      process.stdout.write(`  ${C.dim}└──────────────────────────────────────────┘${C.reset}\n`);
    }

    process.stdout.write('\n');
  }

  renderAnomaly(result: LiveScoreResult): void {
    if (!result.anomalyDetails || result.anomalyDetails.length === 0) return;

    process.stdout.write(
      `  ${C.bgRed}${C.white}${C.bold} ANOMALY DETECTED ${C.reset} trace ${C.bold}${shortId(result.traceId)}${C.reset}\n`,
    );

    for (const detail of result.anomalyDetails) {
      const deviation = detail.stddev > 0
        ? ((Math.abs(detail.value - detail.mean) / detail.stddev).toFixed(1) + 'σ')
        : 'σ=0';
      process.stdout.write(
        `  ${C.dim}${detail.metric}:${C.reset} ${C.red}${(detail.value * 100).toFixed(1)}%${C.reset}` +
        ` ${C.dim}(avg ${(detail.mean * 100).toFixed(1)}%, ${deviation} from mean)${C.reset}\n`,
      );
    }
    process.stdout.write('\n');
  }

  renderStats(stats: {
    totalTraces: number;
    avgScore: number;
    anomalyCount: number;
    sessionCount: number;
  }): void {
    const { colorThreshold } = this.config;
    const line = '─'.repeat(50);
    process.stdout.write(`${C.dim}├${line}┤${C.reset}\n`);
    process.stdout.write(
      `${C.dim}│${C.reset}  traces: ${C.bold}${stats.totalTraces}${C.reset}` +
        `  avg: ${formatScore(stats.avgScore, colorThreshold)}` +
        `  anomalies: ${stats.anomalyCount > 0 ? `${C.red}${stats.anomalyCount}${C.reset}` : `${C.dim}0${C.reset}`}` +
        `  sessions: ${C.dim}${stats.sessionCount}${C.reset}` +
        `  ${C.dim}│${C.reset}\n`,
    );
    process.stdout.write(`${C.dim}└${line}┘${C.reset}\n\n`);
  }

  renderWaiting(): void {
    process.stdout.write(`${C.dim}  Waiting for traces... (pipe OTel JSON lines to stdin)${C.reset}\n\n`);
  }

  renderSummary(stats: {
    totalTraces: number;
    avgScore: number;
    anomalyCount: number;
    passRate: number;
  }): void {
    const { colorThreshold } = this.config;
    const line = '═'.repeat(50);
    process.stdout.write(`\n${C.bold}${C.cyan}╔${line}╗${C.reset}\n`);
    process.stdout.write(`${C.bold}${C.cyan}║${C.reset}  ${C.bold}Session Summary${C.reset}${' '.repeat(33)}${C.bold}${C.cyan}║${C.reset}\n`);
    process.stdout.write(`${C.bold}${C.cyan}╠${line}╣${C.reset}\n`);

    const rows = [
      ['Traces scored', String(stats.totalTraces)],
      ['Average score', `${formatScore(stats.avgScore, colorThreshold)}`],
      ['Pass rate', `${formatScore(stats.passRate, colorThreshold)}`],
      ['Anomalies detected', stats.anomalyCount > 0 ? `${C.red}${stats.anomalyCount}${C.reset}` : `${C.green}0${C.reset}`],
    ];

    for (const [label, value] of rows) {
      const labelPadded = padRight(label, 22);
      process.stdout.write(
        `${C.bold}${C.cyan}║${C.reset}  ${labelPadded} ${value}${' '.repeat(Math.max(0, 24 - value.replace(/\x1b\[[0-9;]*m/g, '').length))}${C.bold}${C.cyan}║${C.reset}\n`,
      );
    }

    process.stdout.write(`${C.bold}${C.cyan}╚${line}╝${C.reset}\n`);
  }

  private renderBar(score: number, width: number): string {
    const { colorThreshold } = this.config;
    const filled = Math.round(score * width);
    const empty = width - filled;
    const color = scoreColor(score, colorThreshold);
    return `${C.dim}[${C.reset}${color}${'█'.repeat(filled)}${C.reset}${C.dim}${'░'.repeat(empty)}]${C.reset}`;
  }
}
