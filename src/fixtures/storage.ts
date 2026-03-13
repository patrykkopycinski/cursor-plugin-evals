import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { dirname } from 'node:path';

async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

function parseJsonlLines(content: string): unknown[] {
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSON at line ${idx + 1}: ${line.slice(0, 120)}`);
      }
    });
}

function serializeJsonlLines(records: unknown[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

export async function readJsonlGz(filePath: string): Promise<unknown[]> {
  const compressed = await readFile(filePath);
  const decompressed = gunzipSync(compressed);
  return parseJsonlLines(decompressed.toString('utf-8'));
}

export async function writeJsonlGz(filePath: string, records: unknown[]): Promise<void> {
  await ensureDir(filePath);
  const content = serializeJsonlLines(records);
  const compressed = gzipSync(Buffer.from(content, 'utf-8'));
  await writeFile(filePath, compressed);
}

export async function appendJsonlGz(filePath: string, record: unknown): Promise<void> {
  await ensureDir(filePath);

  let existing: unknown[] = [];
  try {
    existing = await readJsonlGz(filePath);
  } catch (err: unknown) {
    const isNotFound =
      err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (!isNotFound) throw err;
  }

  existing.push(record);
  await writeJsonlGz(filePath, existing);
}

export async function readJsonl(filePath: string): Promise<unknown[]> {
  const content = await readFile(filePath, 'utf-8');
  return parseJsonlLines(content);
}

export async function writeJsonl(filePath: string, records: unknown[]): Promise<void> {
  await ensureDir(filePath);
  await writeFile(filePath, serializeJsonlLines(records), 'utf-8');
}
