import { stringify as yamlStringify } from 'yaml';
import type { DatasetFile, DatasetExample, DatasetVersion } from './storage.js';
import { readDataset, writeDataset, listDatasetFiles, simpleChecksum } from './storage.js';

export type { DatasetFile, DatasetExample, DatasetVersion } from './storage.js';

export interface DatasetMeta {
  name: string;
  description: string;
  version: number;
  exampleCount: number;
  createdAt: string;
  updatedAt: string;
}

export function createDataset(name: string, description: string, basePath?: string): DatasetFile {
  const existing = readDataset(name, basePath);
  if (existing) {
    throw new Error(`Dataset "${name}" already exists`);
  }

  const now = new Date().toISOString();
  const dataset: DatasetFile = {
    name,
    description,
    version: 1,
    createdAt: now,
    updatedAt: now,
    examples: [],
    versions: [
      {
        version: 1,
        createdAt: now,
        exampleCount: 0,
        checksum: simpleChecksum([]),
      },
    ],
  };

  writeDataset(dataset, basePath);
  return dataset;
}

export function listDatasets(basePath?: string): DatasetMeta[] {
  const names = listDatasetFiles(basePath);
  const result: DatasetMeta[] = [];

  for (const name of names) {
    const ds = readDataset(name, basePath);
    if (!ds) continue;
    result.push({
      name: ds.name,
      description: ds.description,
      version: ds.version,
      exampleCount: ds.examples.length,
      createdAt: ds.createdAt,
      updatedAt: ds.updatedAt,
    });
  }

  return result;
}

export function addExample(
  datasetName: string,
  example: DatasetExample,
  basePath?: string,
): DatasetFile {
  const dataset = readDataset(datasetName, basePath);
  if (!dataset) {
    throw new Error(`Dataset "${datasetName}" not found`);
  }

  dataset.examples.push(example);
  dataset.updatedAt = new Date().toISOString();
  writeDataset(dataset, basePath);
  return dataset;
}

export function versionDataset(datasetName: string, basePath?: string): DatasetVersion {
  const dataset = readDataset(datasetName, basePath);
  if (!dataset) {
    throw new Error(`Dataset "${datasetName}" not found`);
  }

  const newVersion = dataset.version + 1;
  const snapshot: DatasetVersion = {
    version: newVersion,
    createdAt: new Date().toISOString(),
    exampleCount: dataset.examples.length,
    checksum: simpleChecksum(dataset.examples),
  };

  dataset.version = newVersion;
  dataset.versions.push(snapshot);
  dataset.updatedAt = snapshot.createdAt;
  writeDataset(dataset, basePath);
  return snapshot;
}

export function exportToYaml(datasetName: string, basePath?: string): string {
  const dataset = readDataset(datasetName, basePath);
  if (!dataset) {
    throw new Error(`Dataset "${datasetName}" not found`);
  }

  const suiteConfig = {
    name: dataset.name,
    layer: 'llm',
    tests: dataset.examples.map((ex, i) => ({
      name: ex.metadata?.name ?? `${dataset.name}-example-${i + 1}`,
      prompt: ex.input.prompt ?? JSON.stringify(ex.input),
      expected: ex.expected ?? {},
      evaluators: ['tool-selection'],
    })),
  };

  return yamlStringify(suiteConfig);
}

export function annotateExample(
  datasetName: string,
  exampleIndex: number,
  annotation: { status?: 'pass' | 'fail' | 'skip'; notes?: string },
  basePath?: string,
): DatasetFile {
  const dataset = readDataset(datasetName, basePath);
  if (!dataset) {
    throw new Error(`Dataset "${datasetName}" not found`);
  }

  if (exampleIndex < 0 || exampleIndex >= dataset.examples.length) {
    throw new Error(
      `Example index ${exampleIndex} out of range (0..${dataset.examples.length - 1})`,
    );
  }

  dataset.examples[exampleIndex].annotation = {
    ...dataset.examples[exampleIndex].annotation,
    ...annotation,
    annotatedAt: new Date().toISOString(),
  };
  dataset.updatedAt = new Date().toISOString();
  writeDataset(dataset, basePath);
  return dataset;
}
