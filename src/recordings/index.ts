import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { gzipSync, gunzipSync } from 'zlib';
import { randomUUID } from 'crypto';

export interface RecordedRun {
  runId: string;
  timestamp: string;
  skill: string;
  adapter: string;
  model: string;
  examples: RecordedExample[];
}

export interface RecordedExample {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  toolCalls: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: unknown;
    latencyMs: number;
  }>;
  latencyMs: number;
  tokenUsage: { input: number; output: number; cached?: number } | null;
}

export async function saveRecording(dir: string, run: RecordedRun): Promise<string> {
  const skillDir = join(dir, run.skill);
  await mkdir(skillDir, { recursive: true });

  const id = run.runId || randomUUID();
  const filePath = join(skillDir, `${id}.jsonl.gz`);
  const lines = run.examples.map((ex) => JSON.stringify(ex)).join('\n');
  const header = JSON.stringify({
    runId: id,
    timestamp: run.timestamp,
    skill: run.skill,
    adapter: run.adapter,
    model: run.model,
  });
  const payload = `${header}\n${lines}`;
  await writeFile(filePath, gzipSync(Buffer.from(payload, 'utf-8')));
  return filePath;
}

export async function loadRecording(
  dir: string,
  skill: string,
  runId?: string,
): Promise<RecordedRun | null> {
  const skillDir = join(dir, skill);

  if (runId) {
    const filePath = join(skillDir, `${runId}.jsonl.gz`);
    return parseRecordingFile(filePath);
  }

  const recordings = await listRecordings(dir, skill);
  if (recordings.length === 0) return null;

  recordings.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return parseRecordingFile(recordings[0].path);
}

async function parseRecordingFile(filePath: string): Promise<RecordedRun | null> {
  let compressed: Buffer;
  try {
    compressed = await readFile(filePath);
  } catch {
    return null;
  }

  const content = gunzipSync(compressed).toString('utf-8');
  const [headerLine, ...exampleLines] = content.split('\n');
  const header = JSON.parse(headerLine) as Omit<RecordedRun, 'examples'>;
  const examples = exampleLines
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RecordedExample);

  return { ...header, examples };
}

export async function listRecordings(
  dir: string,
  skill?: string,
): Promise<Array<{ skill: string; runId: string; timestamp: string; path: string }>> {
  const results: Array<{ skill: string; runId: string; timestamp: string; path: string }> = [];

  let skills: string[];
  try {
    skills = skill ? [skill] : await readdir(dir);
  } catch {
    return results;
  }

  for (const s of skills) {
    const skillDir = join(dir, s);
    let files: string[];
    try {
      files = await readdir(skillDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl.gz')) continue;
      const filePath = join(skillDir, file);
      const recording = await parseRecordingFile(filePath);
      if (!recording) continue;

      results.push({
        skill: s,
        runId: recording.runId,
        timestamp: recording.timestamp,
        path: filePath,
      });
    }
  }

  return results;
}
