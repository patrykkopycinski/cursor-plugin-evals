import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../core/constants.js';

const DATASETS_DIR = join(DATA_DIR, 'datasets');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getDatasetsDir(basePath: string = process.cwd()): string {
  return join(basePath, DATASETS_DIR);
}

function getDatasetPath(basePath: string, name: string): string {
  return join(getDatasetsDir(basePath), `${name}.json`);
}

export interface DatasetFile {
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  examples: DatasetExample[];
  versions: DatasetVersion[];
}

export interface DatasetExample {
  input: Record<string, unknown>;
  expected?: unknown;
  metadata?: Record<string, unknown>;
  annotation?: {
    status?: 'pass' | 'fail' | 'skip';
    notes?: string;
    annotatedAt?: string;
  };
}

export interface DatasetVersion {
  version: number;
  createdAt: string;
  exampleCount: number;
  checksum: string;
}

function simpleChecksum(examples: DatasetExample[]): string {
  const str = JSON.stringify(examples);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function readDataset(name: string, basePath?: string): DatasetFile | null {
  const filePath = getDatasetPath(basePath ?? process.cwd(), name);
  if (!existsSync(filePath)) return null;

  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as DatasetFile;
}

export function writeDataset(dataset: DatasetFile, basePath?: string): void {
  const dir = getDatasetsDir(basePath ?? process.cwd());
  ensureDir(dir);
  const filePath = join(dir, `${dataset.name}.json`);
  writeFileSync(filePath, JSON.stringify(dataset, null, 2), 'utf-8');
}

export function listDatasetFiles(basePath?: string): string[] {
  const dir = getDatasetsDir(basePath ?? process.cwd());
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

export function deleteDatasetFile(name: string, basePath?: string): boolean {
  const filePath = getDatasetPath(basePath ?? process.cwd(), name);
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

export { getDatasetsDir, simpleChecksum };
