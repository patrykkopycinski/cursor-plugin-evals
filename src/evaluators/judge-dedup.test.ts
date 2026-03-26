import { describe, it, expect, vi } from 'vitest';
import { DedupJudge } from './judge-dedup.js';
import type { JudgeResponse } from './llm-judge.js';

describe('DedupJudge', () => {
  it('deduplicates identical concurrent requests', async () => {
    const mockCall = vi.fn<[{ systemPrompt: string; userPrompt: string }], Promise<JudgeResponse>>()
      .mockResolvedValue({ score: 0.9, label: 'CORRECT', explanation: 'good' });

    const dedup = new DedupJudge(mockCall);

    const [r1, r2] = await Promise.all([
      dedup.call({ systemPrompt: 'A', userPrompt: 'B' }),
      dedup.call({ systemPrompt: 'A', userPrompt: 'B' }),
    ]);

    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(r1.score).toBe(0.9);
    expect(r2.score).toBe(0.9);
  });

  it('makes separate calls for different inputs', async () => {
    const mockCall = vi.fn().mockResolvedValue({ score: 0.5, label: 'OK', explanation: 'ok' });
    const dedup = new DedupJudge(mockCall);

    await Promise.all([
      dedup.call({ systemPrompt: 'A', userPrompt: 'B' }),
      dedup.call({ systemPrompt: 'A', userPrompt: 'C' }),
    ]);

    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it('allows new calls after previous batch completes', async () => {
    const mockCall = vi.fn().mockResolvedValue({ score: 0.7, label: 'OK', explanation: 'ok' });
    const dedup = new DedupJudge(mockCall);

    await dedup.call({ systemPrompt: 'A', userPrompt: 'B' });
    await dedup.call({ systemPrompt: 'A', userPrompt: 'B' });

    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it('propagates errors to all waiters', async () => {
    const mockCall = vi.fn().mockRejectedValue(new Error('API down'));
    const dedup = new DedupJudge(mockCall);

    const results = await Promise.allSettled([
      dedup.call({ systemPrompt: 'A', userPrompt: 'B' }),
      dedup.call({ systemPrompt: 'A', userPrompt: 'B' }),
    ]);

    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
  });
});
