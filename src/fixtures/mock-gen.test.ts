import { join } from 'node:path';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { writeJsonlGz } from './storage.js';
import { generateMockServer } from './mock-gen.js';

const TMP_DIR = join(__dirname, '__tmp_mock_gen_test__');

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

function createFixtureFile(toolName: string, entries: unknown[]): void {
  const fixtureDir = join(TMP_DIR, 'fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  const filePath = join(fixtureDir, `${toolName}.jsonl.gz`);
  writeJsonlGz(filePath, entries);
}

describe('generateMockServer', () => {
  it('generates a valid .mjs file with expected structure', async () => {
    const fixtureDir = join(TMP_DIR, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });

    await writeJsonlGz(join(fixtureDir, 'test_tool.jsonl.gz'), [
      {
        tool: 'test_tool',
        argsHash: 'abc123',
        args: { query: 'hello' },
        result: { content: [{ type: 'text', text: 'world' }], isError: false },
        latencyMs: 50,
        timestamp: '2025-01-01T00:00:00Z',
      },
    ]);

    const outputPath = join(TMP_DIR, 'mock-server.mjs');
    await generateMockServer(fixtureDir, outputPath);

    expect(existsSync(outputPath)).toBe(true);

    const content = readFileSync(outputPath, 'utf-8');

    expect(content).toContain('#!/usr/bin/env node');
    expect(content).toContain('@modelcontextprotocol/sdk/server/index.js');
    expect(content).toContain('StdioServerTransport');
    expect(content).toContain('FIXTURE_DATA_B64');
    expect(content).toContain('tools/list');
    expect(content).toContain('tools/call');
    expect(content).toContain('hashArgs');
  });

  it('embeds fixture data as base64', async () => {
    const fixtureDir = join(TMP_DIR, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });

    await writeJsonlGz(join(fixtureDir, 'my_tool.jsonl.gz'), [
      {
        tool: 'my_tool',
        argsHash: 'def456',
        args: { path: '/test' },
        result: { content: [{ type: 'text', text: 'ok' }] },
        latencyMs: 10,
        timestamp: '2025-01-01T00:00:00Z',
      },
    ]);

    const outputPath = join(TMP_DIR, 'mock.mjs');
    await generateMockServer(fixtureDir, outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    const b64Match = content.match(/FIXTURE_DATA_B64 = "([^"]+)"/);
    expect(b64Match).not.toBeNull();

    const decoded = Buffer.from(b64Match![1], 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    expect(parsed).toHaveProperty('my_tool');
    expect(parsed.my_tool).toHaveLength(1);
    expect(parsed.my_tool[0].argsHash).toBe('def456');
  });

  it('handles multiple tools', async () => {
    const fixtureDir = join(TMP_DIR, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });

    await writeJsonlGz(join(fixtureDir, 'tool_a.jsonl.gz'), [
      {
        tool: 'tool_a',
        argsHash: 'a1',
        args: {},
        result: { content: [{ type: 'text', text: 'a' }] },
        latencyMs: 5,
        timestamp: '2025-01-01T00:00:00Z',
      },
    ]);

    await writeJsonlGz(join(fixtureDir, 'tool_b.jsonl.gz'), [
      {
        tool: 'tool_b',
        argsHash: 'b1',
        args: { x: 1 },
        result: { content: [{ type: 'text', text: 'b' }] },
        latencyMs: 5,
        timestamp: '2025-01-01T00:00:00Z',
      },
    ]);

    const outputPath = join(TMP_DIR, 'multi.mjs');
    await generateMockServer(fixtureDir, outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    const b64Match = content.match(/FIXTURE_DATA_B64 = "([^"]+)"/);
    const decoded = Buffer.from(b64Match![1], 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    expect(Object.keys(parsed)).toContain('tool_a');
    expect(Object.keys(parsed)).toContain('tool_b');
  });

  it('throws when fixture directory does not exist', async () => {
    const outputPath = join(TMP_DIR, 'out.mjs');
    await expect(
      generateMockServer('/nonexistent/path/xyz', outputPath),
    ).rejects.toThrow('Fixture directory not found');
  });

  it('throws when fixture directory has no .jsonl.gz files', async () => {
    const emptyDir = join(TMP_DIR, 'empty-fixtures');
    mkdirSync(emptyDir, { recursive: true });

    const outputPath = join(TMP_DIR, 'out.mjs');
    await expect(generateMockServer(emptyDir, outputPath)).rejects.toThrow(
      'No .jsonl.gz files found',
    );
  });

  it('creates output directory if it does not exist', async () => {
    const fixtureDir = join(TMP_DIR, 'fixtures');
    mkdirSync(fixtureDir, { recursive: true });

    await writeJsonlGz(join(fixtureDir, 'tool.jsonl.gz'), [
      {
        tool: 'tool',
        argsHash: 'h1',
        args: {},
        result: { content: [{ type: 'text', text: 'ok' }] },
        latencyMs: 1,
        timestamp: '2025-01-01T00:00:00Z',
      },
    ]);

    const nested = join(TMP_DIR, 'deep', 'nested', 'mock.mjs');
    await generateMockServer(fixtureDir, nested);
    expect(existsSync(nested)).toBe(true);
  });
});
