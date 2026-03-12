import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import type { EvaluationDataset, Example } from '../../core/types.js';

export function loadSkillDataset(skillDir: string): EvaluationDataset {
  const evalPath = resolve(skillDir, 'eval.yaml');
  let raw: string;

  try {
    raw = readFileSync(evalPath, 'utf-8');
  } catch {
    throw new Error(`eval.yaml not found in ${skillDir}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid YAML in ${evalPath}: ${msg}`);
  }

  const data = parsed as Record<string, unknown>;

  if (!data.name || typeof data.name !== 'string') {
    throw new Error(`eval.yaml in ${skillDir} is missing required "name" field`);
  }

  const examples = data.examples as Array<Record<string, unknown>> | undefined;
  if (!examples || !Array.isArray(examples) || examples.length === 0) {
    throw new Error(`eval.yaml in ${skillDir} is missing required "examples" array`);
  }

  const parsedExamples: Example[] = examples.map((ex, i) => {
    const input = ex.input as Record<string, unknown> | string | undefined;
    if (!input) {
      throw new Error(`Example ${i} in ${evalPath} is missing "input" field`);
    }

    const normalizedInput = typeof input === 'string' ? { prompt: input } : input;

    return {
      input: normalizedInput as Record<string, unknown>,
      output: ex.output ?? ex.expected ?? undefined,
      metadata: (ex.metadata ?? {}) as Record<string, unknown>,
    };
  });

  return {
    name: data.name as string,
    description: (data.description as string) ?? '',
    examples: parsedExamples,
    adapters: data.adapters as string[] | undefined,
    evaluators: data.evaluators as string[] | undefined,
    defaults: data.defaults as EvaluationDataset['defaults'],
  };
}
