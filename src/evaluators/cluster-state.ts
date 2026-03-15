import type {
  AssertionConfig,
  AssertionOp,
  ClusterStateAssertion,
  ClusterCheckType,
  Evaluator,
  EvaluatorContext,
  EvaluatorResult,
} from '../core/types.js';
import { resolveDotPath } from '../core/utils.js';

function checkAssertion(value: unknown, op: AssertionOp, expected?: unknown): boolean {
  switch (op) {
    case 'eq':
      return JSON.stringify(value) === JSON.stringify(expected);
    case 'neq':
      return JSON.stringify(value) !== JSON.stringify(expected);
    case 'gt':
      return typeof value === 'number' && typeof expected === 'number' && value > expected;
    case 'gte':
      return typeof value === 'number' && typeof expected === 'number' && value >= expected;
    case 'lt':
      return typeof value === 'number' && typeof expected === 'number' && value < expected;
    case 'lte':
      return typeof value === 'number' && typeof expected === 'number' && value <= expected;
    case 'contains':
      if (typeof value === 'string' && typeof expected === 'string') {
        return value.includes(expected);
      }
      if (Array.isArray(value)) {
        return value.includes(expected);
      }
      return false;
    case 'not_contains':
      if (typeof value === 'string' && typeof expected === 'string') {
        return !value.includes(expected);
      }
      if (Array.isArray(value)) {
        return !value.includes(expected);
      }
      return true;
    case 'exists':
      return value !== undefined && value !== null;
    case 'not_exists':
      return value === undefined || value === null;
    case 'length_gte': {
      if (Array.isArray(value)) return typeof expected === 'number' && value.length >= expected;
      if (typeof value === 'string') return typeof expected === 'number' && value.length >= expected;
      return false;
    }
    case 'length_lte': {
      if (Array.isArray(value)) return typeof expected === 'number' && value.length <= expected;
      if (typeof value === 'string') return typeof expected === 'number' && value.length <= expected;
      return false;
    }
    case 'type':
      if (expected === 'array') return Array.isArray(value);
      if (expected === 'null') return value === null;
      return typeof value === expected;
    case 'matches':
      try {
        return (
          typeof value === 'string' &&
          typeof expected === 'string' &&
          new RegExp(expected).test(value)
        );
      } catch {
        return false;
      }
    case 'one_of':
      return (
        Array.isArray(expected) && expected.some((e) => JSON.stringify(e) === JSON.stringify(value))
      );
    case 'starts_with':
      return (
        typeof value === 'string' && typeof expected === 'string' && value.startsWith(expected)
      );
    case 'ends_with':
      return typeof value === 'string' && typeof expected === 'string' && value.endsWith(expected);
    default: {
      if (typeof op === 'string' && op.startsWith('not_')) {
        const baseOp = op.slice(4) as AssertionOp;
        return !checkAssertion(value, baseOp, expected);
      }
      return false;
    }
  }
}

function buildKibanaHeaders(config: Record<string, unknown> | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'kbn-xsrf': 'true',
    'x-elastic-internal-origin': 'Kibana',
  };

  const apiKey = (config?.['kibanaApiKey'] as string | undefined) ?? process.env.KIBANA_API_KEY;
  const username =
    (config?.['kibanaUsername'] as string | undefined) ??
    process.env.KIBANA_USERNAME ??
    process.env.TEST_ES_USERNAME;
  const password =
    (config?.['kibanaPassword'] as string | undefined) ??
    process.env.KIBANA_PASSWORD ??
    process.env.TEST_ES_PASSWORD;

  if (apiKey) {
    headers['Authorization'] = `ApiKey ${apiKey}`;
  } else if (username && password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  return headers;
}

function buildEsHeaders(config: Record<string, unknown> | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const apiKey = (config?.['esApiKey'] as string | undefined) ?? process.env.ES_API_KEY;
  const username = (config?.['esUsername'] as string | undefined) ?? process.env.TEST_ES_USERNAME;
  const password = (config?.['esPassword'] as string | undefined) ?? process.env.TEST_ES_PASSWORD;

  if (apiKey) {
    headers['Authorization'] = `ApiKey ${apiKey}`;
  } else if (username && password) {
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  return headers;
}

async function executeHttpRequest(
  baseUrl: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const fetchOpts: RequestInit = { method: method.toUpperCase(), headers };

  if (body && method.toUpperCase() !== 'GET') {
    fetchOpts.body = JSON.stringify(body);
  }

  const res = await fetch(url, fetchOpts);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

async function executeScriptCheck(
  script: string,
  skillsDir?: string,
): Promise<{ passed: boolean; details: string }> {
  const { execFileSync } = await import('child_process');
  const { resolve } = await import('path');

  const scriptPath = skillsDir ? resolve(skillsDir, script) : resolve(script);

  try {
    const output = execFileSync('node', [scriptPath], {
      timeout: 30_000,
      encoding: 'utf-8',
      env: { ...process.env },
      cwd: skillsDir ?? process.cwd(),
    });

    try {
      const result = JSON.parse(output.trim()) as Record<string, unknown>;
      const passed = result.passed === true || result.success === true;
      return { passed, details: (result.message as string) ?? output.trim().slice(0, 200) };
    } catch {
      return { passed: true, details: output.trim().slice(0, 200) };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { passed: false, details: `Script error: ${msg.slice(0, 300)}` };
  }
}

interface AssertionResult {
  assertion: ClusterStateAssertion;
  check: AssertionConfig;
  value: unknown;
  pass: boolean;
  error?: string;
}

export class ClusterStateEvaluator implements Evaluator {
  readonly name = 'cluster-state';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const esUrl =
      (context.config?.['esUrl'] as string | undefined) ??
      process.env.ELASTICSEARCH_URL ??
      process.env.ES_URL;
    const kibanaUrl =
      (context.config?.['kibanaUrl'] as string | undefined) ?? process.env.KIBANA_URL;
    const skillsDir = context.config?.['skillsDir'] as string | undefined;
    const assertions = context.expected?.clusterState;

    if (!assertions || assertions.length === 0) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'skip',
        explanation: 'No cluster state assertions specified; skipping evaluation.',
      };
    }

    const results: AssertionResult[] = [];

    for (const assertion of assertions) {
      const checkType: ClusterCheckType = assertion.type ?? 'es_query';

      if (checkType === 'script') {
        if (!assertion.script) {
          results.push({
            assertion,
            check: assertion.assert[0] ?? { field: '', op: 'exists' as AssertionOp },
            value: undefined,
            pass: false,
            error: 'No script path specified',
          });
          continue;
        }

        const scriptResult = await executeScriptCheck(assertion.script, skillsDir);
        results.push({
          assertion,
          check: assertion.assert[0] ?? { field: 'result', op: 'eq' as AssertionOp, value: true },
          value: scriptResult.passed,
          pass: scriptResult.passed,
          error: scriptResult.passed ? undefined : scriptResult.details,
        });
        continue;
      }

      let baseUrl: string | undefined;
      let headers: Record<string, string>;

      if (checkType === 'kibana_api') {
        baseUrl = kibanaUrl;
        if (!baseUrl) {
          results.push({
            assertion,
            check: assertion.assert[0] ?? { field: '', op: 'exists' as AssertionOp },
            value: undefined,
            pass: false,
            error: 'config.kibanaUrl or KIBANA_URL is required for kibana_api checks',
          });
          continue;
        }
        headers = buildKibanaHeaders(context.config);
      } else {
        baseUrl = esUrl;
        if (!baseUrl) {
          results.push({
            assertion,
            check: assertion.assert[0] ?? { field: '', op: 'exists' as AssertionOp },
            value: undefined,
            pass: false,
            error: 'config.esUrl or ELASTICSEARCH_URL is required for es_query checks',
          });
          continue;
        }
        headers = buildEsHeaders(context.config);
      }

      let responseBody: unknown;
      let fetchError: string | undefined;

      try {
        responseBody = await executeHttpRequest(
          baseUrl,
          assertion.method,
          assertion.path,
          headers,
          assertion.body,
        );
      } catch (err) {
        fetchError = err instanceof Error ? err.message : String(err);
      }

      if (!assertion.assert || assertion.assert.length === 0) {
        results.push({
          assertion,
          check: { field: '_status', op: 'exists' as AssertionOp },
          value: fetchError ? undefined : responseBody,
          pass: !fetchError,
          error: fetchError,
        });
        continue;
      }

      for (const check of assertion.assert) {
        if (fetchError) {
          results.push({ assertion, check, value: undefined, pass: false, error: fetchError });
          continue;
        }

        const value = resolveDotPath(responseBody, check.field);
        const pass = checkAssertion(value, check.op, check.value);
        results.push({ assertion, check, value, pass });
      }
    }

    const total = results.length;
    const passed = results.filter((r) => r.pass).length;
    const score = total > 0 ? Math.round((passed / total) * 1000) / 1000 : 1.0;
    const failures = results.filter((r) => !r.pass);

    const details = results
      .map((r, i) => {
        const desc =
          r.assertion.description ??
          `Check ${i + 1}: ${r.assertion.type ?? 'es_query'} ${r.assertion.method} ${r.assertion.path ?? ''}`;
        return `${r.pass ? 'PASS' : 'FAIL'}: ${desc}${r.error ? ` — ${r.error}` : ''}`;
      })
      .join('\n');

    return {
      evaluator: this.name,
      score,
      pass: passed === total,
      label: passed === total ? 'pass' : 'fail',
      explanation:
        `${passed}/${total} cluster state checks passed.` +
        (failures.length > 0
          ? ` Failures: ${failures
              .map(
                (f) =>
                  `${f.assertion.type ?? 'es_query'} ${f.assertion.method} ${f.assertion.path} → ${f.check.field} ${f.check.op}${f.error ? ` (${f.error})` : ''}`,
              )
              .join('; ')}.`
          : ''),
      metadata: {
        total,
        passed,
        details,
        results: results.map((r) => ({
          type: r.assertion.type ?? 'es_query',
          method: r.assertion.method,
          path: r.assertion.path,
          field: r.check.field,
          op: r.check.op,
          expected: r.check.value,
          actual: r.value,
          pass: r.pass,
          error: r.error,
        })),
      },
    };
  }
}
