import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../adapters/bedrock.js', () => ({
  getBedrockConfig: () => null,
  signBedrockRequest: vi.fn(),
  buildBedrockBody: vi.fn(),
  parseBedrockResponse: vi.fn(),
}));

// Mock the cache module to use an in-memory store (no disk I/O)
const memoryStore = new Map<string, string>();
vi.mock('../cache/index.js', () => {
  return {
    LlmCache: class MockLlmCache {
      async get(_m: string, sys: string, usr: string) {
        return memoryStore.get(`${sys}\x00${usr}`) ?? undefined;
      }
      async set(_m: string, sys: string, usr: string, response: string) {
        memoryStore.set(`${sys}\x00${usr}`, response);
      }
      getStats() { return { hits: 0, misses: 0 }; }
    },
  };
});

import { callJudge, getJudgeCache } from './llm-judge.js';

describe('callJudge caching', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('JUDGE_CACHE', 'true');
    memoryStore.clear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"score": 0.9, "label": "CORRECT", "explanation": "good"}' } }],
        }),
    });
  });

  it('returns cached response on second call with same inputs', async () => {
    const req = { systemPrompt: 'Judge this', userPrompt: 'test input' };
    const first = await callJudge(req);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first.score).toBeCloseTo(0.9);

    const second = await callJudge(req);
    expect(mockFetch).toHaveBeenCalledTimes(1); // served from in-memory cache
    expect(second.score).toBeCloseTo(0.9);
  });

  it('makes a new call when inputs differ', async () => {
    await callJudge({ systemPrompt: 'A', userPrompt: 'B' });
    await callJudge({ systemPrompt: 'A', userPrompt: 'C' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('skips cache when cache option is false', async () => {
    const req = { systemPrompt: 'Judge', userPrompt: 'input', cache: false };
    await callJudge(req);
    await callJudge(req);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('skips cache when JUDGE_CACHE env is false', async () => {
    vi.stubEnv('JUDGE_CACHE', 'false');
    const req = { systemPrompt: 'Judge', userPrompt: 'input' };
    await callJudge(req);
    await callJudge(req);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('exposes cache stats via getJudgeCache', () => {
    const cache = getJudgeCache();
    expect(cache).toBeDefined();
    const stats = cache.getStats();
    expect(typeof stats.hits).toBe('number');
    expect(typeof stats.misses).toBe('number');
  });
});
