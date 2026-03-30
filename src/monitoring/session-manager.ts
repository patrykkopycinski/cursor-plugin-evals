import type { TraceEvent } from './consumer.js';
import type { ScoredTrace } from './scorer.js';

export interface Session {
  id: string;
  traceIds: Set<string>;
  events: TraceEvent[];
  startTime: number;
  lastActivity: number;
  scores: Map<string, ScoredTrace>;
  status: 'active' | 'scoring' | 'complete';
}

export interface SessionManagerConfig {
  maxSessions?: number;
  sessionTimeoutMs?: number;
  maxEventsPerSession?: number;
}

// Maps traceId -> sessionId for fast lookup
type TraceIndex = Map<string, string>;

export class SessionManager {
  private readonly maxSessions: number;
  private readonly sessionTimeoutMs: number;
  private readonly maxEventsPerSession: number;
  private readonly sessions = new Map<string, Session>();
  private readonly traceIndex: TraceIndex = new Map();

  constructor(config: SessionManagerConfig = {}) {
    this.maxSessions = config.maxSessions ?? 50;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 120_000;
    this.maxEventsPerSession = config.maxEventsPerSession ?? 5000;
  }

  addEvent(event: TraceEvent): Session {
    const existingSessionId = this.traceIndex.get(event.traceId);

    if (existingSessionId) {
      const session = this.sessions.get(existingSessionId);
      if (session && session.status === 'active') {
        if (session.events.length < this.maxEventsPerSession) {
          session.events.push(event);
        }
        session.lastActivity = Date.now();
        return session;
      }
    }

    // Create a new session for this traceId
    if (this.sessions.size >= this.maxSessions) {
      this.evictOldestSession();
    }

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: Session = {
      id: sessionId,
      traceIds: new Set([event.traceId]),
      events: [event],
      startTime: Date.now(),
      lastActivity: Date.now(),
      scores: new Map(),
      status: 'active',
    };

    this.sessions.set(sessionId, session);
    this.traceIndex.set(event.traceId, sessionId);

    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === 'active');
  }

  getSessionForTrace(traceId: string): Session | undefined {
    const sessionId = this.traceIndex.get(traceId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  expireSessions(): Session[] {
    const now = Date.now();
    const expired: Session[] = [];

    for (const session of this.sessions.values()) {
      if (session.status === 'active' && now - session.lastActivity > this.sessionTimeoutMs) {
        session.status = 'complete';
        // Clean up traceIndex entries to prevent unbounded memory growth
        for (const traceId of session.traceIds) {
          this.traceIndex.delete(traceId);
        }
        this.sessions.delete(session.id);
        expired.push(session);
      }
    }

    return expired;
  }

  private evictOldestSession(): void {
    let oldest: Session | undefined;
    for (const session of this.sessions.values()) {
      if (!oldest || session.lastActivity < oldest.lastActivity) {
        oldest = session;
      }
    }
    if (oldest) {
      for (const traceId of oldest.traceIds) {
        this.traceIndex.delete(traceId);
      }
      this.sessions.delete(oldest.id);
    }
  }
}
