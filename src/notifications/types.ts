export interface NotificationConfig {
  slack?: { webhookUrl: string; channel?: string };
  github?: { enabled: boolean };
  webhook?: { url: string; headers?: Record<string, string> };
  triggers?: Array<'ci-fail' | 'regression' | 'quality-drop'>;
}

export interface NotificationPayload {
  type: 'ci-fail' | 'regression' | 'quality-drop' | 'run-complete';
  title: string;
  summary: string;
  details?: string;
  score?: number;
  passRate?: number;
  url?: string;
}

export interface Notifier {
  name: string;
  send(payload: NotificationPayload): Promise<void>;
}
