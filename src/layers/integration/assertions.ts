import type { AssertionConfig, AssertionOp } from '../../core/types.js';

export interface AssertionResult {
  field: string;
  op: string;
  pass: boolean;
  actual: unknown;
  expected: unknown;
}

export interface EvaluationResult {
  pass: boolean;
  results: AssertionResult[];
}

function resolveDotPath(obj: unknown, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isFinite(index)) {
        current = current[index];
        continue;
      }
    }

    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

const OPERATORS: Record<AssertionOp, (actual: unknown, expected: unknown) => boolean> = {
  eq: (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected),

  neq: (actual, expected) => JSON.stringify(actual) !== JSON.stringify(expected),

  gt: (actual, expected) =>
    typeof actual === 'number' && typeof expected === 'number' && actual > expected,

  gte: (actual, expected) =>
    typeof actual === 'number' && typeof expected === 'number' && actual >= expected,

  lt: (actual, expected) =>
    typeof actual === 'number' && typeof expected === 'number' && actual < expected,

  lte: (actual, expected) =>
    typeof actual === 'number' && typeof expected === 'number' && actual <= expected,

  contains: (actual, expected) => {
    if (typeof actual === 'string' && typeof expected === 'string') {
      return actual.includes(expected);
    }
    if (Array.isArray(actual)) {
      return actual.some((item) => JSON.stringify(item) === JSON.stringify(expected));
    }
    return false;
  },

  not_contains: (actual, expected) => {
    if (typeof actual === 'string' && typeof expected === 'string') {
      return !actual.includes(expected);
    }
    if (Array.isArray(actual)) {
      return !actual.some((item) => JSON.stringify(item) === JSON.stringify(expected));
    }
    return true;
  },

  exists: (actual) => actual !== undefined && actual !== null,

  not_exists: (actual) => actual === undefined || actual === null,

  length_gte: (actual, expected) => {
    const len = Array.isArray(actual)
      ? actual.length
      : typeof actual === 'string'
        ? actual.length
        : -1;
    return typeof expected === 'number' && len >= expected;
  },

  length_lte: (actual, expected) => {
    const len = Array.isArray(actual)
      ? actual.length
      : typeof actual === 'string'
        ? actual.length
        : Infinity;
    return typeof expected === 'number' && len <= expected;
  },

  type: (actual, expected) => {
    if (typeof expected !== 'string') return false;
    if (expected === 'array') return Array.isArray(actual);
    if (expected === 'null') return actual === null;
    return typeof actual === expected;
  },

  matches: (actual, expected) => {
    if (typeof actual !== 'string' || typeof expected !== 'string') return false;
    try {
      return new RegExp(expected).test(actual);
    } catch {
      return false;
    }
  },
};

export function evaluateAssertions(
  response: unknown,
  assertions: AssertionConfig[],
): EvaluationResult {
  const results: AssertionResult[] = [];
  let allPass = true;

  for (const assertion of assertions) {
    const actual = resolveDotPath(response, assertion.field);
    const operator = OPERATORS[assertion.op];

    if (!operator) {
      results.push({
        field: assertion.field,
        op: assertion.op,
        pass: false,
        actual,
        expected: assertion.value,
      });
      allPass = false;
      continue;
    }

    const pass = operator(actual, assertion.value);
    if (!pass) allPass = false;

    results.push({
      field: assertion.field,
      op: assertion.op,
      pass,
      actual,
      expected: assertion.value,
    });
  }

  return { pass: allPass, results };
}
