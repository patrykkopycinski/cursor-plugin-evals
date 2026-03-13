import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SuiteConfig } from '../core/types.js';

export async function loadTypeScriptSuites(patterns: string[]): Promise<SuiteConfig[]> {
  const suites: SuiteConfig[] = [];

  for (const pattern of patterns) {
    const files: string[] = [];
    for await (const file of glob(pattern)) {
      files.push(file);
    }

    for (const file of files) {
      const fullPath = file.startsWith('/') ? file : resolve(process.cwd(), file);
      const mod = await import(fullPath);
      const exported = mod.default ?? mod;

      if (Array.isArray(exported)) {
        for (const suite of exported) {
          suites.push(suite as SuiteConfig);
        }
      } else if (
        exported &&
        typeof exported === 'object' &&
        'name' in exported &&
        'layer' in exported
      ) {
        suites.push(exported as SuiteConfig);
      }
    }
  }

  return suites;
}
