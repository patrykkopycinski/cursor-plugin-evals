import type { ExpectedOutput } from '../core/types.js';
import { FieldAssertion } from './assertions.js';

export function field(fieldPath: string): FieldAssertion {
  return new FieldAssertion(fieldPath);
}

export function tools(expected: string[]): Partial<ExpectedOutput> {
  return { tools: expected };
}

export function toolSequence(expected: string[]): Partial<ExpectedOutput> {
  return { toolSequence: expected };
}

export function toolArgs(tool: string, args: Record<string, unknown>): Partial<ExpectedOutput> {
  return { toolArgs: { [tool]: args } };
}

export function responseContains(values: string[]): Partial<ExpectedOutput> {
  return { responseContains: values };
}

export function responseNotContains(values: string[]): Partial<ExpectedOutput> {
  return { responseNotContains: values };
}
