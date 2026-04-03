import { readFileSync } from 'node:fs';
import type { LlmTestConfig } from '../core/types.js';

export interface GoldenEntry {
  input: string;
  goldenOutput: string;
}

// Internal raw format from JSON files
interface RawGoldenEntry {
  input: string;
  golden_output: string;
}

export function loadGoldenDataset(content: string, format: 'json' | 'jsonl'): GoldenEntry[] {
  if (format === 'jsonl') {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const raw = JSON.parse(line) as RawGoldenEntry;
        return { input: raw.input, goldenOutput: raw.golden_output };
      });
  }

  // format === 'json'
  const raw = JSON.parse(content) as RawGoldenEntry[];
  return raw.map((entry) => ({ input: entry.input, goldenOutput: entry.golden_output }));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

export function goldenToLlmTests(
  entries: GoldenEntry[],
  options?: { evaluators?: string[] },
): LlmTestConfig[] {
  const evaluators = options?.evaluators ?? ['correctness'];

  return entries.map((entry, i) => ({
    name: `golden-${i}-${slugify(entry.input)}`,
    prompt: entry.input,
    expected: {
      responseContains: [entry.goldenOutput],
    },
    evaluators,
  }));
}

export function loadGoldenDatasetFromFile(filePath: string): GoldenEntry[] {
  const content = readFileSync(filePath, 'utf-8');
  const format = filePath.endsWith('.jsonl') ? 'jsonl' : 'json';
  return loadGoldenDataset(content, format);
}
