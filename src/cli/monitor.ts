import { Command } from 'commander';
import * as http from 'node:http';
import { consumeStdin, parseOtelJsonLine, type TraceEvent } from '../monitoring/consumer.js';
import { LiveScorer, type LiveScoreResult } from '../monitoring/live-scorer.js';
import { TerminalUI } from '../monitoring/terminal-ui.js';

interface MonitorOptions {
  evaluators: string;
  port?: string;
  compact: boolean;
  details: boolean;
  json: boolean;
  anomalyThreshold: string;
  sessionTimeout: string;
}

/** Convert nanosecond timestamp (string or number) to milliseconds safely */
function nanosToMs(ns: unknown): number {
  if (ns == null) return 0;
  if (typeof ns === 'string') return Number(BigInt(ns) / 1_000_000n);
  if (typeof ns === 'number') return ns / 1e6;
  return 0;
}

function parseOtlpBody(body: Record<string, unknown>): TraceEvent[] {
  const events: TraceEvent[] = [];

  const resourceSpans = body.resourceSpans as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(resourceSpans)) return events;

  for (const rs of resourceSpans) {
    const scopeSpans = rs.scopeSpans as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(scopeSpans)) continue;

    for (const ss of scopeSpans) {
      const spans = ss.spans as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(spans)) continue;

      for (const span of spans) {
        const traceId = String(span.traceId ?? '');
        const spanId = String(span.spanId ?? '');
        if (!traceId || !spanId) continue;

        const rawAttrs = span.attributes as Array<{ key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean } }> | undefined;
        const attributes: Record<string, unknown> = {};
        if (Array.isArray(rawAttrs)) {
          for (const attr of rawAttrs) {
            const val = attr.value?.stringValue ?? attr.value?.intValue ?? attr.value?.doubleValue ?? attr.value?.boolValue;
            attributes[attr.key] = val;
          }
        }

        const startTime = nanosToMs(span.startTimeUnixNano) || Date.now();
        const endTime = nanosToMs(span.endTimeUnixNano) || startTime;

        events.push({
          traceId,
          spanId,
          name: String(span.name ?? ''),
          attributes,
          startTime,
          endTime,
          parentSpanId: span.parentSpanId ? String(span.parentSpanId) : undefined,
        });
      }
    }
  }

  return events;
}

function createHttpServer(
  port: number,
  scorer: LiveScorer,
  ui: TerminalUI,
  jsonMode: boolean,
): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/traces') {
      res.writeHead(404);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const events = parseOtlpBody(body);

      scorer.processBatch(events).then((results) => {
        for (const result of results) {
          emitResult(result, ui, jsonMode);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ partialSuccess: {} }));
      }).catch(() => {
        res.writeHead(500);
        res.end();
      });
    });

    req.on('error', () => {
      res.writeHead(400);
      res.end();
    });
  });
}

function emitResult(result: LiveScoreResult, ui: TerminalUI, jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  ui.renderScore(result);
  if (result.anomaly) {
    ui.renderAnomaly(result);
  }
}

export function registerMonitorCommand(program: Command): void {
  program
    .command('monitor')
    .description('Live scoring — score OTel traces in real-time as they arrive')
    .option(
      '--evaluators <names>',
      'Comma-separated evaluator names',
      'tool-selection,response-quality,security',
    )
    .option('--port <number>', 'Start HTTP OTLP receiver on this port (default: stdin mode)')
    .option('--compact', 'Single-line output per trace', false)
    .option('--details', 'Show per-evaluator score breakdown', false)
    .option('--json', 'Output JSON lines instead of formatted text', false)
    .option('--anomaly-threshold <number>', 'Z-score threshold for anomaly detection', '2.0')
    .option('--session-timeout <ms>', 'Session inactivity timeout in ms', '120000')
    .action(async (opts: MonitorOptions) => {
      const evaluators = opts.evaluators.split(',').map((e) => e.trim()).filter(Boolean);
      const port = opts.port ? parseInt(opts.port, 10) : undefined;
      const anomalyZThreshold = parseFloat(opts.anomalyThreshold);
      const sessionTimeoutMs = parseInt(opts.sessionTimeout, 10);

      const ui = new TerminalUI({
        compact: opts.compact,
        showDetails: opts.details,
      });

      if (!opts.json) {
        ui.renderHeader({
          evaluators,
          mode: port ? `HTTP OTLP receiver (port ${port})` : 'stdin',
          port,
        });
      }

      let statsInterval: ReturnType<typeof setInterval> | undefined;
      let totalAtStart = 0;

      const scorer = new LiveScorer({
        evaluators,
        anomalyZThreshold,
        sessionTimeoutMs,
        onScore: (result) => emitResult(result, ui, opts.json),
        onAnomaly: (result) => {
          if (!opts.json) ui.renderAnomaly(result);
        },
      });

      const onExit = (): void => {
        scorer.stop();
        if (statsInterval) clearInterval(statsInterval);

        if (!opts.json) {
          const stats = scorer.getStats();
          ui.renderSummary({
            totalTraces: stats.totalTraces,
            avgScore: stats.avgScore,
            anomalyCount: stats.anomalyCount,
            passRate: stats.passRate,
          });
        }

        process.exit(0);
      };

      process.on('SIGINT', onExit);
      process.on('SIGTERM', onExit);

      if (port) {
        // HTTP mode
        const server = createHttpServer(port, scorer, ui, opts.json);

        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(port, () => {
            if (!opts.json) {
              process.stdout.write(
                `\x1b[36m  OTLP receiver listening on http://localhost:${port}/v1/traces\x1b[0m\n\n`,
              );
            }
            resolve();
          });
        });

        // Print periodic stats while server is running
        if (!opts.json) {
          statsInterval = setInterval(() => {
            const stats = scorer.getStats();
            if (stats.totalTraces > totalAtStart) {
              totalAtStart = stats.totalTraces;
              ui.renderStats(stats);
            }
          }, 10_000);
        }

        // Keep process alive until signal
        await new Promise<void>(() => {
          // Intentionally never resolves — SIGINT/SIGTERM handlers call process.exit
        });
      } else {
        // Stdin mode
        if (!opts.json) {
          ui.renderWaiting();
        }

        await scorer.processStream(consumeStdin());

        const stats = scorer.getStats();
        if (!opts.json) {
          ui.renderSummary({
            totalTraces: stats.totalTraces,
            avgScore: stats.avgScore,
            anomalyCount: stats.anomalyCount,
            passRate: stats.passRate,
          });
        }

        process.exit(0);
      }
    });
}
