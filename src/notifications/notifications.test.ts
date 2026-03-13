import { describe, it, expect, vi } from 'vitest';
import { createNotifiers, sendNotifications } from './index.js';
import type { NotificationPayload, Notifier } from './types.js';

describe('createNotifiers', () => {
  it('returns empty array for empty config', () => {
    const notifiers = createNotifiers({});
    expect(notifiers).toHaveLength(0);
  });

  it('creates slack notifier when webhookUrl is provided', () => {
    const notifiers = createNotifiers({
      slack: { webhookUrl: 'https://hooks.slack.com/test' },
    });
    expect(notifiers).toHaveLength(1);
    expect(notifiers[0].name).toBe('slack');
  });

  it('creates github notifier when enabled', () => {
    const notifiers = createNotifiers({
      github: { enabled: true },
    });
    expect(notifiers).toHaveLength(1);
    expect(notifiers[0].name).toBe('github');
  });

  it('does not create github notifier when disabled', () => {
    const notifiers = createNotifiers({
      github: { enabled: false },
    });
    expect(notifiers).toHaveLength(0);
  });

  it('creates webhook notifier when url is provided', () => {
    const notifiers = createNotifiers({
      webhook: { url: 'https://example.com/hook', headers: { 'X-Token': 'abc' } },
    });
    expect(notifiers).toHaveLength(1);
    expect(notifiers[0].name).toBe('webhook');
  });

  it('creates multiple notifiers simultaneously', () => {
    const notifiers = createNotifiers({
      slack: { webhookUrl: 'https://hooks.slack.com/test' },
      github: { enabled: true },
      webhook: { url: 'https://example.com/hook' },
    });
    expect(notifiers).toHaveLength(3);
    const names = notifiers.map((n) => n.name);
    expect(names).toContain('slack');
    expect(names).toContain('github');
    expect(names).toContain('webhook');
  });
});

describe('sendNotifications', () => {
  const payload: NotificationPayload = {
    type: 'run-complete',
    title: 'Eval Run Complete',
    summary: 'All tests passed',
    score: 0.95,
    passRate: 1.0,
  };

  it('returns success for all notifiers that succeed', async () => {
    const mockNotifier: Notifier = {
      name: 'mock',
      send: vi.fn().mockResolvedValue(undefined),
    };

    const results = await sendNotifications([mockNotifier], payload);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ notifier: 'mock', success: true });
    expect(mockNotifier.send).toHaveBeenCalledWith(payload);
  });

  it('captures errors without throwing', async () => {
    const failNotifier: Notifier = {
      name: 'failing',
      send: vi.fn().mockRejectedValue(new Error('network down')),
    };

    const results = await sendNotifications([failNotifier], payload);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('network down');
  });

  it('handles mixed success and failure', async () => {
    const goodNotifier: Notifier = {
      name: 'good',
      send: vi.fn().mockResolvedValue(undefined),
    };
    const badNotifier: Notifier = {
      name: 'bad',
      send: vi.fn().mockRejectedValue(new Error('fail')),
    };

    const results = await sendNotifications([goodNotifier, badNotifier], payload);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ notifier: 'good', success: true });
    expect(results[1].success).toBe(false);
  });

  it('returns empty array for no notifiers', async () => {
    const results = await sendNotifications([], payload);
    expect(results).toEqual([]);
  });
});
