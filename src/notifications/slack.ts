import type { Notifier, NotificationPayload } from './types.js';

export class SlackNotifier implements Notifier {
  readonly name = 'slack';
  private webhookUrl: string;
  private channel?: string;

  constructor(webhookUrl: string, channel?: string) {
    this.webhookUrl = webhookUrl;
    this.channel = channel;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const color = payload.type === 'run-complete' ? '#36a64f' : '#d00000';
    const body: Record<string, unknown> = {
      attachments: [
        {
          color,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: payload.title, emoji: true },
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: payload.summary },
            },
            ...(payload.details
              ? [
                  {
                    type: 'section',
                    text: { type: 'mrkdwn', text: payload.details },
                  },
                ]
              : []),
            ...(payload.score !== undefined || payload.passRate !== undefined
              ? [
                  {
                    type: 'section',
                    fields: [
                      ...(payload.score !== undefined
                        ? [{ type: 'mrkdwn', text: `*Score:* ${payload.score.toFixed(2)}` }]
                        : []),
                      ...(payload.passRate !== undefined
                        ? [
                            {
                              type: 'mrkdwn',
                              text: `*Pass Rate:* ${(payload.passRate * 100).toFixed(1)}%`,
                            },
                          ]
                        : []),
                    ],
                  },
                ]
              : []),
            ...(payload.url
              ? [
                  {
                    type: 'actions',
                    elements: [
                      {
                        type: 'button',
                        text: { type: 'plain_text', text: 'View Details' },
                        url: payload.url,
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
      ],
    };

    if (this.channel) {
      body.channel = this.channel;
    }

    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Slack webhook failed (${res.status}): ${text}`);
    }
  }
}
