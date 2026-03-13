import type { NotificationConfig, NotificationPayload, Notifier } from './types.js';
import { SlackNotifier } from './slack.js';
import { GitHubNotifier } from './github.js';
import { WebhookNotifier } from './webhook.js';

export type { NotificationConfig, NotificationPayload, Notifier } from './types.js';
export { SlackNotifier } from './slack.js';
export { GitHubNotifier } from './github.js';
export { WebhookNotifier } from './webhook.js';

export function createNotifiers(config: NotificationConfig): Notifier[] {
  const notifiers: Notifier[] = [];

  if (config.slack?.webhookUrl) {
    notifiers.push(new SlackNotifier(config.slack.webhookUrl, config.slack.channel));
  }

  if (config.github?.enabled) {
    notifiers.push(new GitHubNotifier());
  }

  if (config.webhook?.url) {
    notifiers.push(new WebhookNotifier(config.webhook.url, config.webhook.headers));
  }

  return notifiers;
}

export async function sendNotifications(
  notifiers: Notifier[],
  payload: NotificationPayload,
): Promise<Array<{ notifier: string; success: boolean; error?: string }>> {
  const results: Array<{ notifier: string; success: boolean; error?: string }> = [];

  for (const notifier of notifiers) {
    try {
      await notifier.send(payload);
      results.push({ notifier: notifier.name, success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ notifier: notifier.name, success: false, error: message });
    }
  }

  return results;
}
