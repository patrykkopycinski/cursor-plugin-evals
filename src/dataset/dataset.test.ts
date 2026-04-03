import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDataset,
  listDatasets,
  addExample,
  versionDataset,
  exportToYaml,
  annotateExample,
} from './manager.js';
import { readDataset } from './storage.js';

const testDir = join(tmpdir(), `dataset-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe('createDataset', () => {
  it('creates a new dataset with metadata', () => {
    const ds = createDataset('my-dataset', 'A test dataset', testDir);
    expect(ds.name).toBe('my-dataset');
    expect(ds.description).toBe('A test dataset');
    expect(ds.version).toBe(1);
    expect(ds.examples).toEqual([]);
    expect(ds.versions).toHaveLength(1);
  });

  it('persists to disk', () => {
    createDataset('persisted', 'test', testDir);
    const loaded = readDataset('persisted', testDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('persisted');
  });

  it('throws if dataset already exists', () => {
    createDataset('dup', 'first', testDir);
    expect(() => createDataset('dup', 'second', testDir)).toThrow('already exists');
  });
});

describe('listDatasets', () => {
  it('returns empty array when no datasets exist', () => {
    const list = listDatasets(testDir);
    expect(list).toEqual([]);
  });

  it('lists all created datasets', () => {
    createDataset('ds-a', 'Dataset A', testDir);
    createDataset('ds-b', 'Dataset B', testDir);
    const list = listDatasets(testDir);
    expect(list).toHaveLength(2);
    const names = list.map((d) => d.name);
    expect(names).toContain('ds-a');
    expect(names).toContain('ds-b');
  });
});

describe('addExample', () => {
  it('adds an example to the dataset', () => {
    createDataset('examples', 'test', testDir);
    const ds = addExample('examples', { input: { prompt: 'hello' } }, testDir);
    expect(ds.examples).toHaveLength(1);
    expect(ds.examples[0].input).toEqual({ prompt: 'hello' });
  });

  it('throws for non-existent dataset', () => {
    expect(() => addExample('nope', { input: { prompt: 'hi' } }, testDir)).toThrow('not found');
  });

  it('appends multiple examples', () => {
    createDataset('multi', 'test', testDir);
    addExample('multi', { input: { prompt: 'first' } }, testDir);
    const ds = addExample('multi', { input: { prompt: 'second' } }, testDir);
    expect(ds.examples).toHaveLength(2);
  });
});

describe('versionDataset', () => {
  it('creates a new version snapshot', () => {
    createDataset('ver', 'test', testDir);
    addExample('ver', { input: { prompt: 'data' } }, testDir);
    const snapshot = versionDataset('ver', testDir);
    expect(snapshot.version).toBe(2);
    expect(snapshot.exampleCount).toBe(1);
    expect(snapshot.checksum).toBeTruthy();
  });

  it('increments version number each time', () => {
    createDataset('multi-ver', 'test', testDir);
    versionDataset('multi-ver', testDir);
    const v3 = versionDataset('multi-ver', testDir);
    expect(v3.version).toBe(3);
  });

  it('throws for non-existent dataset', () => {
    expect(() => versionDataset('missing', testDir)).toThrow('not found');
  });
});

describe('exportToYaml', () => {
  it('exports dataset as YAML suite config', () => {
    createDataset('yaml-ds', 'test', testDir);
    addExample(
      'yaml-ds',
      { input: { prompt: 'test query' }, expected: { tools: ['search'] } },
      testDir,
    );
    const yaml = exportToYaml('yaml-ds', testDir);
    expect(yaml).toContain('yaml-ds');
    expect(yaml).toContain('llm');
    expect(yaml).toContain('test query');
  });

  it('throws for non-existent dataset', () => {
    expect(() => exportToYaml('nope', testDir)).toThrow('not found');
  });
});

describe('annotateExample', () => {
  it('annotates an example with status and notes', () => {
    createDataset('annotated', 'test', testDir);
    addExample('annotated', { input: { prompt: 'q' } }, testDir);
    const ds = annotateExample('annotated', 0, { status: 'pass', notes: 'looks good' }, testDir);
    expect(ds.examples[0].annotation?.status).toBe('pass');
    expect(ds.examples[0].annotation?.notes).toBe('looks good');
    expect(ds.examples[0].annotation?.annotatedAt).toBeTruthy();
  });

  it('throws for out-of-range index', () => {
    createDataset('oob', 'test', testDir);
    addExample('oob', { input: { prompt: 'q' } }, testDir);
    expect(() => annotateExample('oob', 5, { status: 'fail' }, testDir)).toThrow('out of range');
  });

  it('throws for non-existent dataset', () => {
    expect(() => annotateExample('missing', 0, { status: 'pass' }, testDir)).toThrow('not found');
  });

  it('merges annotations without overwriting existing fields', () => {
    createDataset('merge', 'test', testDir);
    addExample('merge', { input: { prompt: 'q' } }, testDir);
    annotateExample('merge', 0, { status: 'fail' }, testDir);
    const ds = annotateExample('merge', 0, { notes: 'fixed now' }, testDir);
    expect(ds.examples[0].annotation?.status).toBe('fail');
    expect(ds.examples[0].annotation?.notes).toBe('fixed now');
  });
});
