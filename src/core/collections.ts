import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join, isAbsolute } from 'path';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'url';
import type { SuiteConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const BUILT_IN_COLLECTIONS_DIR = resolve(__dirname, '..', '..', 'collections');

export function getCollectionsDir(): string {
  return BUILT_IN_COLLECTIONS_DIR;
}

export function resolveCollectionPath(collection: string, configDir?: string): string {
  if (collection.startsWith('./') || collection.startsWith('../') || isAbsolute(collection)) {
    const base = configDir ?? process.cwd();
    return resolve(base, collection);
  }

  const builtIn = join(BUILT_IN_COLLECTIONS_DIR, collection);
  if (existsSync(builtIn)) {
    return builtIn;
  }

  throw new Error(`Collection "${collection}" not found. Checked built-in path: ${builtIn}`);
}

export function loadCollectionSuite(collectionPath: string): SuiteConfig {
  const suiteFile = join(collectionPath, 'suite.yaml');
  if (!existsSync(suiteFile)) {
    throw new Error(`Collection suite.yaml not found at ${suiteFile}`);
  }

  const raw = readFileSync(suiteFile, 'utf-8');
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== 'object' || !('name' in parsed) || !('tests' in parsed)) {
    throw new Error(`Invalid collection suite at ${suiteFile}: must have name and tests`);
  }

  return parsed as SuiteConfig;
}

export function listCollections(): Array<{ name: string; path: string; testCount: number }> {
  if (!existsSync(BUILT_IN_COLLECTIONS_DIR)) {
    return [];
  }

  const entries = readdirSync(BUILT_IN_COLLECTIONS_DIR, { withFileTypes: true });

  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => {
      const dirPath = join(BUILT_IN_COLLECTIONS_DIR, e.name);
      const suiteFile = join(dirPath, 'suite.yaml');
      let testCount = 0;

      if (existsSync(suiteFile)) {
        try {
          const raw = readFileSync(suiteFile, 'utf-8');
          const parsed = parseYaml(raw);
          testCount = Array.isArray(parsed?.tests) ? parsed.tests.length : 0;
        } catch {
          // skip malformed suites
        }
      }

      return { name: e.name, path: dirPath, testCount };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
