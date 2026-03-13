import { writeJsonl, readJsonl, writeJsonlGz, readJsonlGz, appendJsonlGz } from './storage.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TMP_DIR = join(__dirname, '__tmp_storage_test__');

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('JSONL plain text', () => {
  it('writes and reads back records in a roundtrip', async () => {
    const filePath = join(TMP_DIR, 'data.jsonl');
    const records = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];

    await writeJsonl(filePath, records);
    const result = await readJsonl(filePath);

    expect(result).toEqual(records);
  });

  it('handles records with multi-line string values', async () => {
    const filePath = join(TMP_DIR, 'multiline.jsonl');
    const records = [{ text: 'line one' }, { text: 'line two' }, { nested: { deep: 'value' } }];

    await writeJsonl(filePath, records);
    const result = await readJsonl(filePath);

    expect(result).toEqual(records);
  });
});

describe('JSONL gzipped', () => {
  it('writes and reads back gzipped records in a roundtrip', async () => {
    const filePath = join(TMP_DIR, 'data.jsonl.gz');
    const records = [
      { score: 0.95, pass: true },
      { score: 0.42, pass: false },
    ];

    await writeJsonlGz(filePath, records);
    const result = await readJsonlGz(filePath);

    expect(result).toEqual(records);
  });

  it('appends a record to gzipped JSONL', async () => {
    const filePath = join(TMP_DIR, 'append.jsonl.gz');

    await writeJsonlGz(filePath, [{ id: 1 }]);
    await appendJsonlGz(filePath, { id: 2 });
    await appendJsonlGz(filePath, { id: 3 });

    const result = await readJsonlGz(filePath);
    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('append to nonexistent file creates it', async () => {
    const filePath = join(TMP_DIR, 'new.jsonl.gz');

    await appendJsonlGz(filePath, { first: true });
    const result = await readJsonlGz(filePath);

    expect(result).toEqual([{ first: true }]);
  });

  it('reading nonexistent plain JSONL file throws', async () => {
    const filePath = join(TMP_DIR, 'ghost.jsonl');
    await expect(readJsonl(filePath)).rejects.toThrow();
  });

  it('reading nonexistent gzipped file throws', async () => {
    const filePath = join(TMP_DIR, 'ghost.jsonl.gz');
    await expect(readJsonlGz(filePath)).rejects.toThrow();
  });

  it('handles complex nested records', async () => {
    const filePath = join(TMP_DIR, 'complex.jsonl.gz');
    const records = [
      { a: { b: { c: [1, 2, 3] } }, d: null },
      { arr: [{ nested: true }, { nested: false }] },
      { empty: {} },
    ];

    await writeJsonlGz(filePath, records);
    const result = await readJsonlGz(filePath);

    expect(result).toEqual(records);
  });
});
