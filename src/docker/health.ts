export interface ServiceHealth {
  name: string;
  url: string;
  healthy: boolean;
  statusCode?: number;
  error?: string;
}

export interface HealthReport {
  services: ServiceHealth[];
  allHealthy: boolean;
}

interface ServiceDef {
  name: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

const FULL_SERVICES: ServiceDef[] = [
  {
    name: 'test-es',
    url: 'http://localhost:9220/_cluster/health',
    headers: { Authorization: `Basic ${btoa('elastic:changeme')}` },
  },
  {
    name: 'test-kibana',
    url: 'http://localhost:5620/api/status',
  },
  {
    name: 'obs-es',
    url: 'http://localhost:9210/_cluster/health',
    headers: { Authorization: `Basic ${btoa('elastic:changeme')}` },
  },
  {
    name: 'obs-kibana',
    url: 'http://localhost:5601/api/status',
  },
  {
    name: 'edot-collector',
    url: 'http://localhost:4318/v1/traces',
    method: 'HEAD',
  },
];

const LITE_SERVICES: ServiceDef[] = FULL_SERVICES.filter(
  (s) => !s.name.startsWith('test-'),
);

async function checkService(svc: ServiceDef): Promise<ServiceHealth> {
  try {
    const res = await fetch(svc.url, {
      method: svc.method ?? 'GET',
      headers: svc.headers,
      signal: AbortSignal.timeout(5_000),
    });

    return {
      name: svc.name,
      url: svc.url,
      healthy: res.ok,
      statusCode: res.status,
    };
  } catch (err) {
    return {
      name: svc.name,
      url: svc.url,
      healthy: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolveServices(composeFile?: string): ServiceDef[] {
  if (composeFile?.includes('lite')) return LITE_SERVICES;
  return FULL_SERVICES;
}

export async function checkDockerHealth(
  composeFile?: string,
): Promise<HealthReport> {
  const services = resolveServices(composeFile);
  const results = await Promise.all(services.map(checkService));

  return {
    services: results,
    allHealthy: results.every((s) => s.healthy),
  };
}
