import { InvalidArgumentError } from 'commander';

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_CONFIG_ERROR = 2;

export function parsePositiveInt(value: string): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new InvalidArgumentError('Must be a positive integer.');
  }
  return n;
}
