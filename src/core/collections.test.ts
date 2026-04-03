import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import {
  resolveCollectionPath,
  loadCollectionSuite,
  listCollections,
  getCollectionsDir,
} from './collections.js';

const TMP_DIR = join(__dirname, '__tmp_collections_test__');

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('resolveCollectionPath', () => {
  it('resolves built-in collection names', () => {
    const result = resolveCollectionPath('filesystem');
    expect(result).toContain('collections');
    expect(result).toContain('filesystem');
  });

  it('resolves relative paths from configDir', () => {
    const customDir = join(TMP_DIR, 'custom-collection');
    mkdirSync(customDir, { recursive: true });

    const result = resolveCollectionPath('./custom-collection', TMP_DIR);
    expect(result).toBe(customDir);
  });

  it('resolves absolute paths directly', () => {
    const absPath = '/tmp/some-collection';
    const result = resolveCollectionPath(absPath);
    expect(result).toBe(absPath);
  });

  it('throws for unknown built-in collection', () => {
    expect(() => resolveCollectionPath('nonexistent-xyz')).toThrow('not found');
  });
});

describe('loadCollectionSuite', () => {
  it('loads a valid suite.yaml', () => {
    const colDir = join(TMP_DIR, 'test-col');
    mkdirSync(colDir, { recursive: true });
    writeFileSync(
      join(colDir, 'suite.yaml'),
      `name: test-suite\nlayer: integration\ntests:\n  - name: t1\n    tool: my_tool\n    args: {}\n`,
    );

    const suite = loadCollectionSuite(colDir);
    expect(suite.name).toBe('test-suite');
    expect(suite.tests).toHaveLength(1);
  });

  it('throws when suite.yaml is missing', () => {
    const emptyDir = join(TMP_DIR, 'empty');
    mkdirSync(emptyDir, { recursive: true });
    expect(() => loadCollectionSuite(emptyDir)).toThrow('suite.yaml not found');
  });

  it('throws on invalid suite content', () => {
    const colDir = join(TMP_DIR, 'bad-col');
    mkdirSync(colDir, { recursive: true });
    writeFileSync(join(colDir, 'suite.yaml'), 'just_a_string: true\n');
    expect(() => loadCollectionSuite(colDir)).toThrow('must have name and tests');
  });
});

describe('listCollections', () => {
  it('returns built-in collections', () => {
    const collections = listCollections();
    const names = collections.map((c) => c.name);

    expect(names).toContain('filesystem');
    expect(names).toContain('memory');
    expect(names).toContain('github');
    expect(names).toContain('fetch');
  });

  it('returns test counts for each collection', () => {
    const collections = listCollections();

    const fs = collections.find((c) => c.name === 'filesystem');
    expect(fs).toBeDefined();
    expect(fs!.testCount).toBe(12);

    const mem = collections.find((c) => c.name === 'memory');
    expect(mem).toBeDefined();
    expect(mem!.testCount).toBe(10);

    const gh = collections.find((c) => c.name === 'github');
    expect(gh).toBeDefined();
    expect(gh!.testCount).toBe(14);

    const fetch = collections.find((c) => c.name === 'fetch');
    expect(fetch).toBeDefined();
    expect(fetch!.testCount).toBe(10);
  });

  it('excludes _template directory', () => {
    const collections = listCollections();
    const names = collections.map((c) => c.name);
    expect(names).not.toContain('_template');
  });
});

describe('getCollectionsDir', () => {
  it('returns the built-in collections directory', () => {
    const dir = getCollectionsDir();
    expect(dir).toContain('collections');
  });
});
