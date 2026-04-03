import { resolve } from 'node:path';

export interface GeneratorConfig {
  count?: number;
  personas?: string[];
  [key: string]: unknown;
}

export interface GeneratedExample {
  prompt?: string;
  input?: Record<string, unknown>;
  expected?: unknown;
  metadata?: Record<string, unknown>;
  name?: string;
}

type GeneratorFn = (config?: GeneratorConfig) => Promise<GeneratedExample[]>;

export async function loadFromGenerator(
  generatorPath: string,
  config?: GeneratorConfig,
): Promise<GeneratedExample[]> {
  const absolutePath = resolve(generatorPath);

  let mod: Record<string, unknown>;
  try {
    mod = (await import(absolutePath)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to import generator module at "${absolutePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const generator = mod.default;
  if (typeof generator !== 'function') {
    throw new Error(
      `Generator module at "${absolutePath}" must export a default function, got ${typeof generator}`,
    );
  }

  const results = await (generator as GeneratorFn)(config);

  if (!Array.isArray(results)) {
    throw new Error(`Generator at "${absolutePath}" must return an array, got ${typeof results}`);
  }

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    if (!item.prompt && !item.input) {
      throw new Error(`Generator result[${i}] must have either "prompt" or "input" property`);
    }
  }

  return results;
}
