import type { Notifier, NotificationPayload } from './types.js';

export class WebhookNotifier implements Notifier {
  readonly name = 'webhook';
  private url: string;
  private headers: Record<string, string>;

  constructor(url: string, headers?: Record<string, string>) {
    this.url = url;
    this.headers = headers ?? {};
  }

  async send(payload: NotificationPayload): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({
        type: payload.type,
        title: payload.title,
        summary: payload.summary,
        details: payload.details,
        score: payload.score,
        passRate: payload.passRate,
        url: payload.url,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Webhook POST to ${this.url} failed (${res.status}): ${text}`);
    }
  }
}
