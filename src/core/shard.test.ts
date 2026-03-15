import { describe, it, expect } from 'vitest';
import { parseShardArg, shardSuites } from './shard.js';
import type { ShardConfig } from './shard.js';
import { InvalidArgumentError } from 'commander';
import type { SuiteConfig } from './types.js';

function makeSuite(name: string): SuiteConfig {
  return { name, layer: 'unit', tests: [] };
}

describe('parseShardArg', () => {
  it('parses valid "1/4" format', () => {
    expect(parseShardArg('1/4')).toEqual({ index: 1, total: 4 });
  });

  it('parses "3/3"', () => {
    expect(parseShardArg('3/3')).toEqual({ index: 3, total: 3 });
  });

  it('parses "1/1"', () => {
    expect(parseShardArg('1/1')).toEqual({ index: 1, total: 1 });
  });

  it('throws on invalid format (no slash)', () => {
    expect(() => parseShardArg('14')).toThrow(InvalidArgumentError);
  });

  it('throws on invalid format (letters)', () => {
    expect(() => parseShardArg('a/b')).toThrow(InvalidArgumentError);
  });

  it('throws when index is 0', () => {
    expect(() => parseShardArg('0/4')).toThrow(InvalidArgumentError);
  });

  it('throws when index exceeds total', () => {
    expect(() => parseShardArg('5/4')).toThrow(InvalidArgumentError);
  });

  it('throws when total is 0', () => {
    expect(() => parseShardArg('0/0')).toThrow(InvalidArgumentError);
  });

  it('throws on negative values', () => {
    expect(() => parseShardArg('-1/4')).toThrow(InvalidArgumentError);
  });

  it('throws on empty string', () => {
    expect(() => parseShardArg('')).toThrow(InvalidArgumentError);
  });
});

describe('shardSuites', () => {
  it('returns all suites when total is 1', () => {
    const suites = [makeSuite('a'), makeSuite('b'), makeSuite('c')];
    const result = shardSuites(suites, { index: 1, total: 1 });
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.name)).toEqual(['a', 'b', 'c']);
  });

  it('splits 4 suites into 2 shards evenly', () => {
    const suites = [makeSuite('a'), makeSuite('b'), makeSuite('c'), makeSuite('d')];
    const shard1 = shardSuites(suites, { index: 1, total: 2 });
    const shard2 = shardSuites(suites, { index: 2, total: 2 });

    expect(shard1.map((s) => s.name)).toEqual(['a', 'c']);
    expect(shard2.map((s) => s.name)).toEqual(['b', 'd']);
  });

  it('handles uneven distribution (5 suites, 3 shards)', () => {
    const suites = [
      makeSuite('a'),
      makeSuite('b'),
      makeSuite('c'),
      makeSuite('d'),
      makeSuite('e'),
    ];
    const shard1 = shardSuites(suites, { index: 1, total: 3 });
    const shard2 = shardSuites(suites, { index: 2, total: 3 });
    const shard3 = shardSuites(suites, { index: 3, total: 3 });

    expect(shard1.map((s) => s.name)).toEqual(['a', 'd']);
    expect(shard2.map((s) => s.name)).toEqual(['b', 'e']);
    expect(shard3.map((s) => s.name)).toEqual(['c']);
  });

  it('assigns every suite to exactly one shard (no duplicates, no missing)', () => {
    const suites = Array.from({ length: 10 }, (_, i) => makeSuite(`suite-${i}`));
    const total = 4;
    const allAssigned: string[] = [];

    for (let index = 1; index <= total; index++) {
      const assigned = shardSuites(suites, { index, total });
      allAssigned.push(...assigned.map((s) => s.name));
    }

    allAssigned.sort();
    const expected = suites.map((s) => s.name).sort();
    expect(allAssigned).toEqual(expected);
  });

  it('returns empty array when more shards than suites', () => {
    const suites = [makeSuite('a'), makeSuite('b')];
    const shard3 = shardSuites(suites, { index: 3, total: 5 });
    expect(shard3).toEqual([]);
  });

  it('is deterministic across calls', () => {
    const suites = [makeSuite('x'), makeSuite('y'), makeSuite('z')];
    const config: ShardConfig = { index: 2, total: 2 };
    const first = shardSuites(suites, config);
    const second = shardSuites(suites, config);
    expect(first.map((s) => s.name)).toEqual(second.map((s) => s.name));
  });

  it('handles empty suites array', () => {
    expect(shardSuites([], { index: 1, total: 3 })).toEqual([]);
  });
});
