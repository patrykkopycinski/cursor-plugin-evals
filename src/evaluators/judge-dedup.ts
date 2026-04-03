import { createHash } from 'node:crypto';
import type { JudgeRequest, JudgeResponse } from './llm-judge.js';

type JudgeFn = (request: JudgeRequest) => Promise<JudgeResponse>;

export class DedupJudge {
  private readonly inflight = new Map<string, Promise<JudgeResponse>>();
  private readonly judgeFn: JudgeFn;

  constructor(judgeFn: JudgeFn) {
    this.judgeFn = judgeFn;
  }

  private computeKey(request: JudgeRequest): string {
    const hash = createHash('sha256');
    hash.update(request.model ?? '');
    hash.update('\x00');
    hash.update(request.systemPrompt);
    hash.update('\x00');
    hash.update(request.userPrompt);
    return hash.digest('hex');
  }

  async call(request: JudgeRequest): Promise<JudgeResponse> {
    const key = this.computeKey(request);

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const promise = this.judgeFn(request).finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }
}
