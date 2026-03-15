import { InvalidArgumentError } from 'commander';
import type { SuiteConfig } from './types.js';

export interface ShardConfig {
  index: number; // 1-based shard index
  total: number; // total number of shards
}

export function parseShardArg(value: string): ShardConfig {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) {
    throw new InvalidArgumentError(
      `Invalid shard format "${value}". Expected "x/y" (e.g. "1/4").`,
    );
  }

  const index = parseInt(match[1], 10);
  const total = parseInt(match[2], 10);

  if (total < 1) {
    throw new InvalidArgumentError('Shard total must be at least 1.');
  }

  if (index < 1 || index > total) {
    throw new InvalidArgumentError(
      `Shard index ${index} out of range. Must be between 1 and ${total}.`,
    );
  }

  return { index, total };
}

export function shardSuites(suites: SuiteConfig[], shard: ShardConfig): SuiteConfig[] {
  return suites.filter((_, i) => (i % shard.total) + 1 === shard.index);
}
