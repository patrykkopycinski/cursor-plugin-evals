export interface SetupResult {
  apiKey: { id: string; name: string; apiKey: string; encoded: string };
  detectionRulesCreated: number;
  alertsCreated: number;
  success: boolean;
  errors: string[];
}

interface ApiKeyResponse {
  id: string;
  name: string;
  api_key: string;
  encoded: string;
}

async function esRequest(
  esUrl: string,
  auth: { user: string; password: string },
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${esUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${auth.user}:${auth.password}`)}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { ok: res.ok, status: res.status, data };
}

async function setKibanaSystemPassword(
  esUrl: string,
  auth: { user: string; password: string },
): Promise<void> {
  const res = await esRequest(esUrl, auth, 'POST', '/_security/user/kibana_system/_password', {
    password: auth.password,
  });
  if (!res.ok) {
    throw new Error(
      `Failed to set kibana_system password: ${res.status} ${JSON.stringify(res.data)}`,
    );
  }
}

async function createApiKey(
  esUrl: string,
  auth: { user: string; password: string },
): Promise<SetupResult['apiKey']> {
  const res = await esRequest(esUrl, auth, 'POST', '/_security/api_key', {
    name: 'cpe-eval-key',
    role_descriptors: {
      all_access: {
        cluster: ['all'],
        index: [{ names: ['*'], privileges: ['all'] }],
      },
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to create API key: ${res.status} ${JSON.stringify(res.data)}`);
  }

  const raw = res.data as ApiKeyResponse;
  return {
    id: raw.id,
    name: raw.name,
    apiKey: raw.api_key,
    encoded: raw.encoded,
  };
}

const SAMPLE_RULES = [
  {
    name: 'Test Detection Rule - SSH Brute Force',
    description: 'Detects SSH brute force attempts (test data)',
    risk_score: 73,
    severity: 'high',
    type: 'query',
    query: 'event.category:authentication AND event.outcome:failure',
    index: ['logs-*', 'auditbeat-*'],
    interval: '5m',
    from: 'now-6m',
    enabled: false,
  },
  {
    name: 'Test Detection Rule - Suspicious Process',
    description: 'Detects suspicious process execution (test data)',
    risk_score: 47,
    severity: 'medium',
    type: 'query',
    query: 'process.name:(curl OR wget) AND event.category:process',
    index: ['logs-*', 'winlogbeat-*'],
    interval: '5m',
    from: 'now-6m',
    enabled: false,
  },
];

async function seedDetectionRules(
  esUrl: string,
  auth: { user: string; password: string },
): Promise<{ created: number; errors: string[] }> {
  await esRequest(esUrl, auth, 'PUT', '/.siem-detection-rules', {
    settings: { number_of_shards: 1, number_of_replicas: 0 },
    mappings: {
      properties: {
        name: { type: 'keyword' },
        description: { type: 'text' },
        risk_score: { type: 'integer' },
        severity: { type: 'keyword' },
        type: { type: 'keyword' },
        query: { type: 'text' },
        enabled: { type: 'boolean' },
      },
    },
  });

  const errors: string[] = [];
  let created = 0;

  for (const [i, rule] of SAMPLE_RULES.entries()) {
    const res = await esRequest(
      esUrl,
      auth,
      'PUT',
      `/.siem-detection-rules/_doc/test-rule-${i}`,
      rule,
    );
    if (res.ok) {
      created++;
    } else {
      errors.push(`Rule "${rule.name}": ${res.status} ${JSON.stringify(res.data)}`);
    }
  }

  return { created, errors };
}

function freshTimestamp(): string {
  return new Date().toISOString();
}

function buildSampleAlerts() {
  return [
    {
      '@timestamp': freshTimestamp(),
      'kibana.alert.rule.name': 'Test Detection Rule - SSH Brute Force',
      'kibana.alert.severity': 'high',
      'kibana.alert.risk_score': 73,
      'kibana.alert.status': 'open',
      'kibana.alert.workflow_status': 'open',
      'event.kind': 'signal',
      'source.ip': '10.0.0.99',
      'user.name': 'admin',
    },
    {
      '@timestamp': freshTimestamp(),
      'kibana.alert.rule.name': 'Test Detection Rule - Suspicious Process',
      'kibana.alert.severity': 'medium',
      'kibana.alert.risk_score': 47,
      'kibana.alert.status': 'open',
      'kibana.alert.workflow_status': 'open',
      'event.kind': 'signal',
      'process.name': 'curl',
      'host.name': 'test-host-01',
    },
  ];
}

async function seedAlerts(
  esUrl: string,
  auth: { user: string; password: string },
): Promise<{ created: number; errors: string[] }> {
  await esRequest(esUrl, auth, 'PUT', '/.siem-signals-default', {
    settings: { number_of_shards: 1, number_of_replicas: 0 },
  });

  const errors: string[] = [];
  let created = 0;

  const alerts = buildSampleAlerts();
  for (const [i, alert] of alerts.entries()) {
    const res = await esRequest(
      esUrl,
      auth,
      'PUT',
      `/.siem-signals-default/_doc/test-alert-${i}`,
      alert,
    );
    if (res.ok) {
      created++;
    } else {
      errors.push(`Alert ${i}: ${res.status} ${JSON.stringify(res.data)}`);
    }
  }

  return { created, errors };
}

export async function setupTestCluster(
  esUrl: string,
  auth: { user: string; password: string },
): Promise<SetupResult> {
  const errors: string[] = [];

  try {
    await setKibanaSystemPassword(esUrl, auth);
  } catch (err) {
    errors.push(`kibana_system password: ${err instanceof Error ? err.message : String(err)}`);
  }

  let apiKey: SetupResult['apiKey'];
  try {
    apiKey = await createApiKey(esUrl, auth);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`API key: ${msg}`);
    return {
      apiKey: { id: '', name: '', apiKey: '', encoded: '' },
      detectionRulesCreated: 0,
      alertsCreated: 0,
      success: false,
      errors,
    };
  }

  const rulesResult = await seedDetectionRules(esUrl, auth);
  errors.push(...rulesResult.errors);

  const alertsResult = await seedAlerts(esUrl, auth);
  errors.push(...alertsResult.errors);

  return {
    apiKey,
    detectionRulesCreated: rulesResult.created,
    alertsCreated: alertsResult.created,
    success: errors.length === 0,
    errors,
  };
}
