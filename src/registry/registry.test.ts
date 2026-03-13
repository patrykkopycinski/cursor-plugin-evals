import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

describe('fetchRegistry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a valid registry response', async () => {
    const { fetchRegistry } = await import('./index.js');

    const mockData = {
      version: 1,
      suites: [
        {
          name: 'test-suite',
          description: 'A test suite',
          version: '1.0.0',
          author: 'tester',
          layer: 'unit',
          url: 'https://example.com/suite.yaml',
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const entries = await fetchRegistry('https://example.com/registry.json');
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('test-suite');
    expect(entries[0].layer).toBe('unit');
    expect(entries[0].url).toBe('https://example.com/suite.yaml');
  });

  it('throws on HTTP error', async () => {
    const { fetchRegistry } = await import('./index.js');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    await expect(fetchRegistry('https://example.com/missing.json')).rejects.toThrow(
      'Failed to fetch registry: 404',
    );
  });

  it('throws on invalid format', async () => {
    const { fetchRegistry } = await import('./index.js');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ version: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(fetchRegistry('https://example.com/bad.json')).rejects.toThrow(
      'Invalid registry format',
    );
  });

  it('returns empty array for registry with no suites', async () => {
    const { fetchRegistry } = await import('./index.js');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ version: 1, suites: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const entries = await fetchRegistry('https://example.com/empty.json');
    expect(entries).toEqual([]);
  });
});

describe('packageSuite', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import('fs');
    const { join } = await import('path');
    const os = await import('os');
    tmpDir = mkdtempSync(join(os.tmpdir(), 'registry-test-'));
  });

  afterEach(async () => {
    const { rmSync } = await import('fs');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts metadata from a suite YAML file', async () => {
    const { packageSuite } = await import('./index.js');
    const { writeFileSync } = await import('fs');
    const { resolve } = await import('path');

    const suitePath = resolve(tmpDir, 'my-suite.yaml');
    writeFileSync(
      suitePath,
      [
        'name: my-suite',
        'description: A great test suite',
        'version: 2.0.0',
        'author: dev-team',
        'layer: llm',
        'tests:',
        '  - name: test-1',
        '    check: registration',
      ].join('\n'),
      'utf-8',
    );

    const entry = packageSuite(suitePath);
    expect(entry.name).toBe('my-suite');
    expect(entry.description).toBe('A great test suite');
    expect(entry.version).toBe('2.0.0');
    expect(entry.author).toBe('dev-team');
    expect(entry.layer).toBe('llm');
    expect(entry.url).toBe('');
  });

  it('uses defaults when metadata fields are missing', async () => {
    const { packageSuite } = await import('./index.js');
    const { writeFileSync } = await import('fs');
    const { resolve } = await import('path');

    const suitePath = resolve(tmpDir, 'minimal.yaml');
    writeFileSync(suitePath, 'tests:\n  - name: t1\n    check: schema\n', 'utf-8');

    const entry = packageSuite(suitePath);
    expect(entry.name).toBe('minimal');
    expect(entry.version).toBe('1.0.0');
    expect(entry.author).toBe('unknown');
    expect(entry.layer).toBe('integration');
  });

  it('throws for missing file', async () => {
    const { packageSuite } = await import('./index.js');
    expect(() => packageSuite('/tmp/does-not-exist.yaml')).toThrow('Suite file not found');
  });
});

describe('pullSuite', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import('fs');
    const { join } = await import('path');
    const os = await import('os');
    tmpDir = mkdtempSync(join(os.tmpdir(), 'pull-suite-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const { rmSync } = await import('fs');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('downloads suite YAML to the target directory', async () => {
    const { pullSuite } = await import('./index.js');
    const { readFileSync, existsSync } = await import('fs');

    const yamlContent = 'name: fetched-suite\nlayer: unit\ntests: []\n';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(yamlContent, { status: 200 }));

    const entry = {
      name: 'fetched-suite',
      description: 'desc',
      version: '1.0.0',
      author: 'author',
      layer: 'unit',
      url: 'https://example.com/fetched-suite.yaml',
    };

    const outPath = await pullSuite(entry, tmpDir);
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, 'utf-8')).toBe(yamlContent);
    expect(outPath).toContain('fetched-suite.yaml');
  });

  it('throws when download fails', async () => {
    const { pullSuite } = await import('./index.js');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const entry = {
      name: 'missing',
      description: '',
      version: '1.0.0',
      author: '',
      layer: 'unit',
      url: 'https://example.com/missing.yaml',
    };

    await expect(pullSuite(entry, tmpDir)).rejects.toThrow('Failed to download suite missing');
  });
});
