import { buildDashboardNdjson, getDashboardId } from './dashboard.js';
import type { DashboardConfig } from './dashboard.js';

export interface KibanaDeployConfig {
  kibanaUrl: string;
  spaceId?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  overwrite?: boolean;
}

interface ImportResponse {
  success: boolean;
  successCount?: number;
  errors?: Array<{ id: string; type: string; error: { message: string } }>;
}

function buildAuthHeaders(config: KibanaDeployConfig): Record<string, string> {
  if (config.apiKey) {
    return { Authorization: `ApiKey ${config.apiKey}` };
  }
  if (config.username && config.password) {
    const encoded = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}

/**
 * Deploy the eval dashboard to Kibana via saved objects import API.
 */
export async function deployDashboard(
  config: KibanaDeployConfig,
  dashboardConfig?: DashboardConfig,
): Promise<{ success: boolean; dashboardId: string; url: string }> {
  const spaceId = config.spaceId ?? 'default';
  const overwrite = config.overwrite ?? true;
  const baseUrl = config.kibanaUrl.replace(/\/$/, '');

  const ndjson = buildDashboardNdjson(dashboardConfig);
  const dashboardId = getDashboardId(dashboardConfig);

  const boundary = '----KibanaDashboardImport';
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="dashboard.ndjson"\r\n` +
    `Content-Type: application/ndjson\r\n` +
    `\r\n` +
    `${ndjson}\r\n` +
    `--${boundary}--`;

  const importUrl = `${baseUrl}/s/${spaceId}/api/saved_objects/_import?overwrite=${overwrite}`;

  const res = await fetch(importUrl, {
    method: 'POST',
    headers: {
      'kbn-xsrf': 'true',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      ...buildAuthHeaders(config),
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '<unreadable>');
    throw new Error(`Kibana import failed (${res.status}): ${text}`);
  }

  const result = (await res.json()) as ImportResponse;

  if (!result.success) {
    const firstError = result.errors?.[0];
    const detail = firstError
      ? `${firstError.type}:${firstError.id} — ${firstError.error.message}`
      : 'unknown error';
    throw new Error(`Kibana saved objects import reported failure: ${detail}`);
  }

  const url = `${baseUrl}/s/${spaceId}/app/dashboards#/view/${dashboardId}`;
  return { success: true, dashboardId, url };
}
