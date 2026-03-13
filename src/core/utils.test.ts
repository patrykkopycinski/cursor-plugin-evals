import { describe, it, expect } from 'vitest';
import { parseEntry, resolveDotPath, mergeDefaults, formatDuration } from './utils.js';

describe('parseEntry', () => {
  it('splits command and args', () => {
    const result = parseEntry('node dist/index.js --verbose');
    expect(result.command).toBe('node');
    expect(result.args).toEqual(['dist/index.js', '--verbose']);
  });

  it('handles single command with no args', () => {
    const result = parseEntry('node');
    expect(result.command).toBe('node');
    expect(result.args).toEqual([]);
  });

  it('handles multiple whitespace characters', () => {
    const result = parseEntry('node  dist/index.js');
    expect(result.command).toBe('node');
    expect(result.args).toEqual(['dist/index.js']);
  });

  it('throws on empty string', () => {
    expect(() => parseEntry('')).toThrow('non-empty');
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseEntry('   ')).toThrow('non-empty');
  });
});

describe('resolveDotPath', () => {
  const data = {
    content: [
      { type: 'text', text: 'hello world' },
      { type: 'image', blob: 'abc123' },
    ],
    isError: false,
    nested: { deep: { value: 42 } },
  };

  it('resolves top-level fields', () => {
    expect(resolveDotPath(data, 'isError')).toBe(false);
  });

  it('resolves nested dot paths', () => {
    expect(resolveDotPath(data, 'nested.deep.value')).toBe(42);
  });

  it('resolves array indices', () => {
    expect(resolveDotPath(data, 'content.0.text')).toBe('hello world');
    expect(resolveDotPath(data, 'content.1.type')).toBe('image');
  });

  it('resolves bracket notation', () => {
    expect(resolveDotPath(data, 'content[0].text')).toBe('hello world');
  });

  it('returns undefined for missing paths', () => {
    expect(resolveDotPath(data, 'missing')).toBeUndefined();
    expect(resolveDotPath(data, 'nested.missing.value')).toBeUndefined();
  });

  it('returns undefined for null/undefined', () => {
    expect(resolveDotPath(null, 'field')).toBeUndefined();
    expect(resolveDotPath(undefined, 'field')).toBeUndefined();
  });

  it('returns undefined for primitive targets', () => {
    expect(resolveDotPath('hello', 'length')).toBeUndefined();
  });
});

describe('mergeDefaults', () => {
  it('merges suite over global', () => {
    const result = mergeDefaults({ timeout: 5000 }, { timeout: 30000, judgeModel: 'gpt-4o' });
    expect(result.timeout).toBe(5000);
    expect(result.judgeModel).toBe('gpt-4o');
  });

  it('deep-merges thresholds', () => {
    const result = mergeDefaults(
      { thresholds: { 'tool-selection': 0.95 } },
      { thresholds: { 'tool-selection': 0.9, 'response-quality': 0.7 } },
    );
    expect(result.thresholds).toEqual({
      'tool-selection': 0.95,
      'response-quality': 0.7,
    });
  });

  it('handles undefined inputs', () => {
    expect(mergeDefaults(undefined, undefined)).toEqual({ thresholds: {} });
    expect(mergeDefaults({ timeout: 5000 }, undefined)).toEqual({
      timeout: 5000,
      thresholds: {},
    });
  });
});

describe('formatDuration', () => {
  it('formats sub-second as ms', () => {
    expect(formatDuration(247)).toBe('247ms');
    expect(formatDuration(0)).toBe('0ms');
  });

  it('rounds fractional ms', () => {
    expect(formatDuration(247.89)).toBe('248ms');
  });

  it('formats seconds with one decimal', () => {
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(60000)).toBe('60.0s');
  });
});
