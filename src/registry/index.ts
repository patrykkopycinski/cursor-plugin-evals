import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface RegistryEntry {
  name: string;
  description: string;
  version: string;
  author: string;
  layer: string;
  url: string;
}

interface RegistryManifest {
  version: number;
  suites: RegistryEntry[];
}

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/patrykkopycinski/cursor-plugin-evals/main/registry.json';

export async function fetchRegistry(registryUrl?: string): Promise<RegistryEntry[]> {
  const url = registryUrl ?? DEFAULT_REGISTRY_URL;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown');
    throw new Error(`Failed to fetch registry: ${res.status} ${res.statusText} — ${body}`);
  }

  const data = (await res.json()) as RegistryManifest;

  if (!data.suites || !Array.isArray(data.suites)) {
    throw new Error('Invalid registry format: missing suites array');
  }

  return data.suites;
}

export async function pullSuite(
  entry: RegistryEntry,
  collectionsDir?: string,
): Promise<string> {
  const dir = collectionsDir ?? resolve(process.cwd(), 'collections');
  mkdirSync(dir, { recursive: true });

  const res = await fetch(entry.url);
  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown');
    throw new Error(`Failed to download suite ${entry.name}: ${res.status} — ${body}`);
  }

  const content = await res.text();
  const filename = `${entry.name}.yaml`;
  const outPath = resolve(dir, filename);
  writeFileSync(outPath, content, 'utf-8');

  return outPath;
}

export function packageSuite(suitePath: string): RegistryEntry {
  if (!existsSync(suitePath)) {
    throw new Error(`Suite file not found: ${suitePath}`);
  }

  const raw = readFileSync(suitePath, 'utf-8');
  const parsed = parseYaml(raw) as Record<string, unknown>;

  const name = (parsed.name as string) ?? basename(suitePath, '.yaml');
  const layer = (parsed.layer as string) ?? 'integration';

  return {
    name,
    description: (parsed.description as string) ?? `${name} test suite`,
    version: (parsed.version as string) ?? '1.0.0',
    author: (parsed.author as string) ?? 'unknown',
    layer,
    url: '',
  };
}
