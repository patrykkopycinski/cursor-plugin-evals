import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';

export interface CacheConfig {
  enabled: boolean;
  ttl: string;
  dir: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
}

interface CacheEntry {
  response: string;
  createdAt: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  enabled: true,
  ttl: '7d',
  dir: '.cursor-plugin-evals/cache',
};

const TTL_MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function parseTtl(ttl: string): number {
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match)
    throw new Error(`Invalid TTL format "${ttl}". Use <number>(s|m|h|d), e.g. "7d", "1h", "30m".`);
  return parseInt(match[1], 10) * TTL_MULTIPLIERS[match[2]];
}

export class LlmCache {
  private readonly config: CacheConfig;
  private readonly ttlMs: number;
  private readonly stats: CacheStats = { hits: 0, misses: 0 };
  private initialized = false;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ttlMs = parseTtl(this.config.ttl);
  }

  private computeKey(model: string, systemPrompt: string, userPrompt: string): string {
    const hash = createHash('sha256');
    hash.update(model);
    hash.update('\x00');
    hash.update(systemPrompt);
    hash.update('\x00');
    hash.update(userPrompt);
    return hash.digest('hex');
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.config.dir, { recursive: true });
    this.initialized = true;
  }

  private entryPath(key: string): string {
    return join(this.config.dir, `${key}.json`);
  }

  async get(model: string, systemPrompt: string, userPrompt: string): Promise<string | undefined> {
    if (!this.config.enabled) {
      this.stats.misses++;
      return undefined;
    }

    const key = this.computeKey(model, systemPrompt, userPrompt);

    try {
      const raw = await readFile(this.entryPath(key), 'utf-8');
      const entry: CacheEntry = JSON.parse(raw);

      if (Date.now() - entry.createdAt > this.ttlMs) {
        this.stats.misses++;
        return undefined;
      }

      this.stats.hits++;
      return entry.response;
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
      if (!isNotFound) throw err;
      this.stats.misses++;
      return undefined;
    }
  }

  async set(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    response: string,
  ): Promise<void> {
    if (!this.config.enabled) return;

    await this.ensureDir();
    const key = this.computeKey(model, systemPrompt, userPrompt);
    const entry: CacheEntry = { response, createdAt: Date.now() };
    await writeFile(this.entryPath(key), JSON.stringify(entry), 'utf-8');
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  async evict(): Promise<number> {
    await this.ensureDir();
    const entries = await readdir(this.config.dir);
    const now = Date.now();
    let evicted = 0;

    for (const filename of entries) {
      if (!filename.endsWith('.json')) continue;
      const filePath = join(this.config.dir, filename);

      try {
        const raw = await readFile(filePath, 'utf-8');
        const entry: CacheEntry = JSON.parse(raw);

        if (now - entry.createdAt > this.ttlMs) {
          await unlink(filePath);
          evicted++;
        }
      } catch {
        // Corrupted or concurrently removed — skip
      }
    }

    return evicted;
  }
}
