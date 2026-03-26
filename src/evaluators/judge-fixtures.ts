import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { JudgeRequest, JudgeResponse } from './llm-judge.js';

interface FixtureEntry {
  key: string;
  request: { systemPrompt: string; userPrompt: string; model?: string };
  response: JudgeResponse;
}

const FIXTURE_FILE = 'judge-fixtures.jsonl';

export class JudgeFixtureStore {
  private readonly dir: string;
  private readonly entries = new Map<string, JudgeResponse>();
  private pending: FixtureEntry[] = [];

  constructor(dir: string) {
    this.dir = dir;
  }

  private computeKey(request: Partial<JudgeRequest>): string {
    const hash = createHash('sha256');
    hash.update(request.model ?? '');
    hash.update('\x00');
    hash.update(request.systemPrompt ?? '');
    hash.update('\x00');
    hash.update(request.userPrompt ?? '');
    return hash.digest('hex');
  }

  async load(): Promise<void> {
    try {
      const content = await readFile(join(this.dir, FIXTURE_FILE), 'utf-8');
      for (const line of content.split('\n').filter(Boolean)) {
        const entry = JSON.parse(line) as FixtureEntry;
        this.entries.set(entry.key, entry.response);
      }
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
      if (!isNotFound) throw err;
    }
  }

  async record(request: Partial<JudgeRequest>, response: JudgeResponse): Promise<void> {
    const key = this.computeKey(request);
    this.entries.set(key, response);
    this.pending.push({
      key,
      request: {
        systemPrompt: request.systemPrompt ?? '',
        userPrompt: request.userPrompt ?? '',
        model: request.model,
      },
      response,
    });
  }

  async replay(request: Partial<JudgeRequest>): Promise<JudgeResponse | null> {
    const key = this.computeKey(request);
    return this.entries.get(key) ?? null;
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    await mkdir(this.dir, { recursive: true });
    const lines = this.pending.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(join(this.dir, FIXTURE_FILE), lines, 'utf-8');
    this.pending = [];
  }
}
