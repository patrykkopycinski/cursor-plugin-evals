import type { ExpectedOutput } from '../core/types.js';
import { FieldAssertion } from './assertions.js';
import { RunAssertion } from './run-assertions.js';
import type { RunCheck } from './run-assertions.js';

export function field(fieldPath: string): FieldAssertion {
  return new FieldAssertion(fieldPath);
}

export function run(): RunAssertion {
  return new RunAssertion();
}

export function maxIterations(n: number): RunCheck {
  return new RunAssertion().maxIterations(n).toChecks()[0];
}

export function noErrors(): RunCheck {
  return new RunAssertion().noErrors().toChecks()[0];
}

export function latencyUnder(ms: number): RunCheck {
  return new RunAssertion().latencyUnder(ms).toChecks()[0];
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
