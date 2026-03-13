import type {
  AssertionConfig,
  AssertionOp,
  ClusterStateAssertion,
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
      const len = Array.isArray(value)
        ? value.length
        : typeof value === 'string'
          ? value.length
          : -1;
      return typeof expected === 'number' && len >= expected;
    }
    case 'length_lte': {
      const len = Array.isArray(value)
        ? value.length
        : typeof value === 'string'
          ? value.length
          : -1;
      return typeof expected === 'number' && len <= expected;
    }
    case 'type':
      if (expected === 'array') return Array.isArray(value);
      if (expected === 'null') return value === null;
      return typeof value === expected;
    case 'matches':
      return (
        typeof value === 'string' &&
        typeof expected === 'string' &&
        new RegExp(expected).test(value)
      );
    case 'one_of':
      return Array.isArray(expected) && expected.some((e) => JSON.stringify(e) === JSON.stringify(value));
    case 'starts_with':
      return typeof value === 'string' && typeof expected === 'string' && value.startsWith(expected);
    case 'ends_with':
      return typeof value === 'string' && typeof expected === 'string' && value.endsWith(expected);
    default:
      return false;
  }
}

async function executeHttpRequest(
  esUrl: string,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const url = `${esUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, { method: method.toUpperCase(), headers });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
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
    const esUrl = context.config?.['esUrl'] as string | undefined;
    const apiKey = context.config?.['esApiKey'] as string | undefined;
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

    if (!esUrl) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: 'config.esUrl is required for cluster-state evaluation.',
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `ApiKey ${apiKey}`;
    }

    const results: AssertionResult[] = [];

    for (const assertion of assertions) {
      let responseBody: unknown;
      let fetchError: string | undefined;

      try {
        responseBody = await executeHttpRequest(esUrl, assertion.method, assertion.path, headers);
      } catch (err) {
        fetchError = err instanceof Error ? err.message : String(err);
      }

      for (const check of assertion.assert) {
        if (fetchError) {
          results.push({
            assertion,
            check,
            value: undefined,
            pass: false,
            error: fetchError,
          });
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

    return {
      evaluator: this.name,
      score,
      pass: passed === total,
      label: passed === total ? 'pass' : 'fail',
      explanation:
        `${passed}/${total} cluster state assertions passed.` +
        (failures.length > 0
          ? ` Failures: ${failures.map((f) => `${f.assertion.method} ${f.assertion.path} → ${f.check.field} ${f.check.op}${f.error ? ` (${f.error})` : ''}`).join('; ')}.`
          : ''),
      metadata: {
        total,
        passed,
        results: results.map((r) => ({
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
