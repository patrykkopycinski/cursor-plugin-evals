import type { TraceEvent } from './consumer.js';
import { scoreTrace } from './scorer.js';
import { createAnomalyDetector, type AnomalyDetector } from './anomaly.js';
import { SessionManager } from './session-manager.js';

export interface LiveScorerConfig {
  evaluators: string[];
  scoreDebounceMs?: number;
  anomalyDetection?: boolean;
  anomalyWindowSize?: number;
  anomalyZThreshold?: number;
  sessionTimeoutMs?: number;
  onScore?: (result: LiveScoreResult) => void;
  onAnomaly?: (result: LiveScoreResult) => void;
}

export interface LiveScoreResult {
  sessionId: string;
  traceId: string;
  timestamp: number;
  scores: Record<string, number>;
  overallScore: number;
  pass: boolean;
  toolsCalled: string[];
  latencyMs: number;
  anomaly: boolean;
  anomalyDetails?: { metric: string; value: number; mean: number; stddev: number }[];
}

interface PendingScore {
  traceId: string;
  sessionId: string;
  timer: ReturnType<typeof setTimeout>;
}

export class LiveScorer {
  private readonly config: Required<
    Omit<LiveScorerConfig, 'onScore' | 'onAnomaly' | 'evaluators'>
  > & {
    evaluators: string[];
    onScore?: (result: LiveScoreResult) => void;
    onAnomaly?: (result: LiveScoreResult) => void;
  };
  private readonly sessionManager: SessionManager;
  private readonly anomalyDetector: AnomalyDetector;
  private readonly pending = new Map<string, PendingScore>();
  private stopped = false;

  private totalTraces = 0;
  private passCount = 0;
  private scoreSumTotal = 0;
  private anomalyCount = 0;

  constructor(config: LiveScorerConfig) {
    this.config = {
      evaluators: config.evaluators,
      scoreDebounceMs: config.scoreDebounceMs ?? 2000,
      anomalyDetection: config.anomalyDetection ?? true,
      anomalyWindowSize: config.anomalyWindowSize ?? 100,
      anomalyZThreshold: config.anomalyZThreshold ?? 2.0,
      sessionTimeoutMs: config.sessionTimeoutMs ?? 120_000,
      onScore: config.onScore,
      onAnomaly: config.onAnomaly,
    };

    this.sessionManager = new SessionManager({ sessionTimeoutMs: this.config.sessionTimeoutMs });
    this.anomalyDetector = createAnomalyDetector(
      this.config.anomalyWindowSize,
      this.config.anomalyZThreshold,
    );
  }

  async processStream(events: AsyncIterable<TraceEvent>): Promise<void> {
    for await (const event of events) {
      if (this.stopped) break;
      this.handleEvent(event);
    }

    // Wait for any pending debounced scores to flush
    await this.flush();
  }

  async processBatch(events: TraceEvent[]): Promise<LiveScoreResult[]> {
    const results: LiveScoreResult[] = [];
    const traceMap = new Map<string, TraceEvent[]>();

    for (const event of events) {
      const list = traceMap.get(event.traceId) ?? [];
      list.push(event);
      traceMap.set(event.traceId, list);
    }

    for (const [traceId, traceEvents] of traceMap) {
      const session = this.sessionManager.addEvent(traceEvents[0]);
      for (let i = 1; i < traceEvents.length; i++) {
        this.sessionManager.addEvent(traceEvents[i]);
      }
      const result = await this.scoreTraceEvents(traceId, session.id, traceEvents);
      if (result) results.push(result);
    }

    return results;
  }

  getStats(): { totalTraces: number; avgScore: number; anomalyCount: number; sessionCount: number; passRate: number } {
    return {
      totalTraces: this.totalTraces,
      avgScore: this.totalTraces > 0 ? this.scoreSumTotal / this.totalTraces : 0,
      anomalyCount: this.anomalyCount,
      sessionCount: this.sessionManager.getActiveSessions().length,
      passRate: this.totalTraces > 0 ? this.passCount / this.totalTraces : 0,
    };
  }

  stop(): void {
    this.stopped = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
    }
    this.pending.clear();
  }

  private handleEvent(event: TraceEvent): void {
    const session = this.sessionManager.addEvent(event);

    // Debounce scoring per traceId — reset timer on each new event
    const existing = this.pending.get(event.traceId);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      this.pending.delete(event.traceId);
      const traceSession = this.sessionManager.getSessionForTrace(event.traceId);
      if (!traceSession) return;

      const traceEvents = traceSession.events.filter((e) => e.traceId === event.traceId);
      this.scoreTraceEvents(event.traceId, traceSession.id, traceEvents)
        .then((result) => {
          if (result) {
            this.config.onScore?.(result);
            if (result.anomaly) {
              this.config.onAnomaly?.(result);
            }
          }
        })
        .catch(() => {
          // Score failed silently — don't crash the stream
        });
    }, this.config.scoreDebounceMs);

    this.pending.set(event.traceId, { traceId: event.traceId, sessionId: session.id, timer });
  }

  private async scoreTraceEvents(
    traceId: string,
    sessionId: string,
    traceEvents: TraceEvent[],
  ): Promise<LiveScoreResult | null> {
    if (traceEvents.length === 0) return null;

    try {
      const scored = await scoreTrace(traceEvents, this.config.evaluators);

      const scoreValues = Object.values(scored.scores);
      const overallScore =
        scoreValues.length > 0 ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : 0;

      const pass = scoreValues.length === 0 || scoreValues.every((s) => s >= 0.5);

      const anomalyDetails: LiveScoreResult['anomalyDetails'] = [];
      let isAnomaly = false;

      if (this.config.anomalyDetection) {
        for (const [metric, value] of Object.entries(scored.scores)) {
          const isMetricAnomaly = this.anomalyDetector.isAnomaly(metric, value);
          if (isMetricAnomaly) {
            const stats = this.anomalyDetector.getStats(metric);
            if (stats) {
              anomalyDetails.push({ metric, value, mean: stats.mean, stddev: stats.stddev });
            }
            isAnomaly = true;
          }
          this.anomalyDetector.addScore(metric, value);
        }

        // Also track overall score anomaly
        const overallAnomaly = this.anomalyDetector.isAnomaly('overall', overallScore);
        if (overallAnomaly) {
          const stats = this.anomalyDetector.getStats('overall');
          if (stats) {
            anomalyDetails.push({
              metric: 'overall',
              value: overallScore,
              mean: stats.mean,
              stddev: stats.stddev,
            });
          }
          isAnomaly = true;
        }
        this.anomalyDetector.addScore('overall', overallScore);
      }

      this.totalTraces++;
      this.scoreSumTotal += overallScore;
      if (pass) this.passCount++;
      if (isAnomaly) this.anomalyCount++;

      return {
        sessionId,
        traceId,
        timestamp: scored.timestamp,
        scores: scored.scores,
        overallScore,
        pass,
        toolsCalled: scored.toolsCalled,
        latencyMs: scored.latencyMs,
        anomaly: isAnomaly,
        anomalyDetails: anomalyDetails.length > 0 ? anomalyDetails : undefined,
      };
    } catch {
      return null;
    }
  }

  private async flush(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      const traceId = pending.traceId;
      const sessionId = pending.sessionId;

      const promise = (async () => {
        const traceSession = this.sessionManager.getSessionForTrace(traceId);
        if (!traceSession) return;
        const traceEvents = traceSession.events.filter((e) => e.traceId === traceId);
        const result = await this.scoreTraceEvents(traceId, sessionId, traceEvents);
        if (result) {
          this.config.onScore?.(result);
          if (result.anomaly) {
            this.config.onAnomaly?.(result);
          }
        }
      })();

      promises.push(promise);
    }

    this.pending.clear();
    await Promise.allSettled(promises);
  }
}
