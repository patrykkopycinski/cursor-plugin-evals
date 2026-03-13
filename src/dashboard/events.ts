export type EvalEvent =
  | { type: 'test-start'; suite: string; test: string }
  | { type: 'test-pass'; suite: string; test: string; score: number }
  | { type: 'test-fail'; suite: string; test: string; score: number; error?: string }
  | { type: 'suite-complete'; suite: string; passed: number; failed: number }
  | { type: 'run-complete'; runId: string; passRate: number };

type Callback = (event: EvalEvent) => void;

export class EvalEventEmitter {
  private listeners: Set<Callback> = new Set();

  emit(event: EvalEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch {
        // Don't let a failing subscriber break the emitter
      }
    }
  }

  subscribe(callback: Callback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

export const globalEmitter = new EvalEventEmitter();
