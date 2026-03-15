import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { interpolateTemplate, executePostRunHooks } from './post-run.js';
import type { PostRunHook, RunResult } from '../core/types.js';

const MOCK_RESULT: RunResult = {
  runId: 'run-abc-123',
  timestamp: '2026-03-15T12:00:00.000Z',
  config: './plugin-eval.yaml',
  suites: [],
  overall: {
    total: 10,
    passed: 8,
    failed: 2,
    skipped: 0,
    passRate: 0.8,
    duration: 5000,
  },
};

describe('interpolateTemplate', () => {
  const summary = {
    runId: 'run-abc-123',
    passRate: 80,
    passed: 8,
    failed: 2,
    total: 10,
    duration: 5000,
    timestamp: '2026-03-15T12:00:00.000Z',
  };

  it('replaces known placeholders', () => {
    const tpl = 'Eval {{runId}}: {{passRate}}% pass rate ({{passed}}/{{total}})';
    expect(interpolateTemplate(tpl, summary)).toBe(
      'Eval run-abc-123: 80% pass rate (8/10)',
    );
  });

  it('leaves unknown placeholders intact', () => {
    expect(interpolateTemplate('Hello {{unknown}}', summary)).toBe('Hello {{unknown}}');
  });

  it('handles template with no placeholders', () => {
    expect(interpolateTemplate('plain text', summary)).toBe('plain text');
  });

  it('replaces multiple occurrences of the same placeholder', () => {
    expect(interpolateTemplate('{{runId}} and {{runId}}', summary)).toBe(
      'run-abc-123 and run-abc-123',
    );
  });

  it('replaces all supported fields', () => {
    const tpl = '{{runId}} {{passRate}} {{passed}} {{failed}} {{total}} {{duration}} {{timestamp}}';
    expect(interpolateTemplate(tpl, summary)).toBe(
      'run-abc-123 80 8 2 10 5000 2026-03-15T12:00:00.000Z',
    );
  });
});

describe('executePostRunHooks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls webhook with JSON body when no template', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 }),
    );

    const hooks: PostRunHook[] = [
      { type: 'webhook', url: 'https://example.com/hook' },
    ];

    await executePostRunHooks(hooks, MOCK_RESULT);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual(
      expect.objectContaining({ 'Content-Type': 'application/json' }),
    );

    const body = JSON.parse(init?.body as string);
    expect(body.runId).toBe('run-abc-123');
    expect(body.passRate).toBe(80);
    expect(body.passed).toBe(8);
    expect(body.failed).toBe(2);
    expect(body.total).toBe(10);
  });

  it('calls webhook with interpolated template body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 }),
    );

    const hooks: PostRunHook[] = [
      {
        type: 'webhook',
        url: 'https://example.com/hook',
        template: 'Run {{runId}}: {{passRate}}% pass',
      },
    ];

    await executePostRunHooks(hooks, MOCK_RESULT);

    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.body).toBe('Run run-abc-123: 80% pass');
    expect(init?.headers).toEqual(
      expect.objectContaining({ 'Content-Type': 'text/plain' }),
    );
  });

  it('merges custom headers for webhook', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 }),
    );

    const hooks: PostRunHook[] = [
      {
        type: 'webhook',
        url: 'https://example.com/hook',
        headers: { Authorization: 'Bearer token123' },
      },
    ];

    await executePostRunHooks(hooks, MOCK_RESULT);

    const [, init] = fetchSpy.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token123');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('logs warning on webhook failure without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    const hooks: PostRunHook[] = [
      { type: 'webhook', url: 'https://example.com/hook' },
    ];

    await expect(executePostRunHooks(hooks, MOCK_RESULT)).resolves.toBeUndefined();
  });

  it('logs warning on fetch network error without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const hooks: PostRunHook[] = [
      { type: 'webhook', url: 'https://example.com/hook' },
    ];

    await expect(executePostRunHooks(hooks, MOCK_RESULT)).resolves.toBeUndefined();
  });

  it('executes script hook with env vars', async () => {
    const execSyncMock = vi.mocked(execSync);
    execSyncMock.mockReturnValue(Buffer.from(''));

    const hooks: PostRunHook[] = [
      { type: 'script', command: 'node scripts/post-eval.js' },
    ];

    await executePostRunHooks(hooks, MOCK_RESULT);

    expect(execSyncMock).toHaveBeenCalledOnce();
    const [cmd, opts] = execSyncMock.mock.calls[0];
    expect(cmd).toBe('node scripts/post-eval.js');
    expect(opts?.env).toEqual(
      expect.objectContaining({
        RUN_ID: 'run-abc-123',
        PASS_RATE: '80',
        PASSED: '8',
        FAILED: '2',
        TOTAL: '10',
      }),
    );
    const input = opts?.input as string;
    const parsed = JSON.parse(input);
    expect(parsed.runId).toBe('run-abc-123');
  });

  it('logs warning on script failure without throwing', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('command not found');
    });

    const hooks: PostRunHook[] = [
      { type: 'script', command: 'nonexistent-command' },
    ];

    await expect(executePostRunHooks(hooks, MOCK_RESULT)).resolves.toBeUndefined();
  });

  it('continues executing remaining hooks when one fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('first fails'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const hooks: PostRunHook[] = [
      { type: 'webhook', url: 'https://example.com/fail' },
      { type: 'webhook', url: 'https://example.com/success' },
    ];

    await executePostRunHooks(hooks, MOCK_RESULT);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
