import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JudgeFixtureStore } from './judge-fixtures.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('JudgeFixtureStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'judge-fixtures-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('records and replays a judge call', async () => {
    const store = new JudgeFixtureStore(tempDir);
    await store.record(
      { systemPrompt: 'Judge this', userPrompt: 'test input', model: 'gpt-5.2' },
      { score: 0.9, label: 'CORRECT', explanation: 'good' },
    );
    const replayed = await store.replay({ systemPrompt: 'Judge this', userPrompt: 'test input', model: 'gpt-5.2' });
    expect(replayed).not.toBeNull();
    expect(replayed!.score).toBe(0.9);
  });

  it('returns null for unrecorded requests', async () => {
    const store = new JudgeFixtureStore(tempDir);
    const result = await store.replay({ systemPrompt: 'A', userPrompt: 'B' });
    expect(result).toBeNull();
  });

  it('records multiple entries', async () => {
    const store = new JudgeFixtureStore(tempDir);
    await store.record(
      { systemPrompt: 'A', userPrompt: '1' },
      { score: 0.5, label: 'OK', explanation: 'a' },
    );
    await store.record(
      { systemPrompt: 'A', userPrompt: '2' },
      { score: 0.8, label: 'GOOD', explanation: 'b' },
    );
    const r1 = await store.replay({ systemPrompt: 'A', userPrompt: '1' });
    const r2 = await store.replay({ systemPrompt: 'A', userPrompt: '2' });
    expect(r1!.score).toBe(0.5);
    expect(r2!.score).toBe(0.8);
  });

  it('persists to disk and loads from a new instance', async () => {
    const store1 = new JudgeFixtureStore(tempDir);
    await store1.record(
      { systemPrompt: 'X', userPrompt: 'Y' },
      { score: 0.7, label: 'OK', explanation: 'persisted' },
    );
    await store1.flush();

    const store2 = new JudgeFixtureStore(tempDir);
    await store2.load();
    const result = await store2.replay({ systemPrompt: 'X', userPrompt: 'Y' });
    expect(result!.explanation).toBe('persisted');
  });

  it('flush is no-op when nothing pending', async () => {
    const store = new JudgeFixtureStore(tempDir);
    await store.flush(); // should not throw
  });
});
