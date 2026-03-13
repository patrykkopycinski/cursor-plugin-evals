import { describe, it, expect } from 'vitest';
import { hashToolArgs, buildMockOutput, type CliFixtureEntry } from './cli-recorder.js';

describe('hashToolArgs', () => {
  it('produces stable hashes for same args', () => {
    const a = hashToolArgs({ foo: 'bar', baz: 1 });
    const b = hashToolArgs({ baz: 1, foo: 'bar' });
    expect(a).toBe(b);
  });

  it('produces different hashes for different args', () => {
    const a = hashToolArgs({ foo: 'bar' });
    const b = hashToolArgs({ foo: 'baz' });
    expect(a).not.toBe(b);
  });
});

describe('buildMockOutput', () => {
  it('builds tool calls from entries', () => {
    const entries: CliFixtureEntry[] = [
      {
        tool: 'shell',
        argsHash: 'abc',
        args: { command: 'echo hello' },
        result: { content: [{ type: 'text', text: 'hello' }], isError: false },
        latencyMs: 50,
        timestamp: new Date().toISOString(),
      },
    ];

    const output = buildMockOutput(entries, 'cursor-cli');
    expect(output.toolCalls).toHaveLength(1);
    expect(output.toolCalls[0].tool).toBe('shell');
    expect(output.output).toBe('hello');
    expect(output.latencyMs).toBe(50);
  });

  it('generates fallback output when no text results', () => {
    const entries: CliFixtureEntry[] = [
      {
        tool: 'shell',
        argsHash: 'abc',
        args: { command: 'rm -rf /tmp/test' },
        result: { content: [{ type: 'text', text: '' }], isError: false },
        latencyMs: 10,
        timestamp: new Date().toISOString(),
      },
    ];

    const output = buildMockOutput(entries, 'gemini-cli');
    expect(output.output).toContain('mock-gemini-cli');
    expect(output.output).toContain('1 tool call');
  });

  it('sums latency across entries', () => {
    const entries: CliFixtureEntry[] = [
      {
        tool: 'shell',
        argsHash: 'a',
        args: { command: 'cmd1' },
        result: { content: [{ type: 'text', text: 'ok' }], isError: false },
        latencyMs: 100,
        timestamp: new Date().toISOString(),
      },
      {
        tool: 'read_file',
        argsHash: 'b',
        args: { path: '/tmp/file' },
        result: { content: [{ type: 'text', text: 'data' }], isError: false },
        latencyMs: 50,
        timestamp: new Date().toISOString(),
      },
    ];

    const output = buildMockOutput(entries, 'cursor-cli');
    expect(output.latencyMs).toBe(150);
    expect(output.toolCalls).toHaveLength(2);
  });
});
