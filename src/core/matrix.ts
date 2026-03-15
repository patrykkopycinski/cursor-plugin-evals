import type { SuiteConfig, LlmTestConfig, TestConfig } from './types.js';

type MatrixCombination = Record<string, string | number>;

function crossProduct(
  dimensions: Record<string, (string | number)[]>,
): MatrixCombination[] {
  const keys = Object.keys(dimensions);
  if (keys.length === 0) return [{}];

  const results: MatrixCombination[] = [];

  function recurse(idx: number, current: MatrixCombination): void {
    if (idx === keys.length) {
      results.push({ ...current });
      return;
    }
    const key = keys[idx];
    for (const value of dimensions[key]) {
      current[key] = value;
      recurse(idx + 1, current);
    }
  }

  recurse(0, {});
  return results;
}

function formatCombinationLabel(combination: MatrixCombination): string {
  return Object.entries(combination)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

function isLlmTest(test: TestConfig): test is LlmTestConfig {
  return 'prompt' in test && 'evaluators' in test;
}

/**
 * Expands a suite with a `matrix` field into one suite per combination.
 * If the suite has no matrix (or it's empty), returns it unchanged in an array.
 *
 * For the `model` dimension, each combination's value is pushed into every
 * LLM test's `models` array so the runner picks the right model.
 * All other dimensions are stored in `matrixValues` for downstream use.
 */
export function expandMatrix(suite: SuiteConfig): SuiteConfig[] {
  if (!suite.matrix || Object.keys(suite.matrix).length === 0) {
    return [suite];
  }

  const combinations = crossProduct(suite.matrix);

  return combinations.map((combo) => {
    const label = formatCombinationLabel(combo);

    const tests: TestConfig[] = suite.tests.map((test) => {
      const cloned = { ...test };

      if (combo.model !== undefined && isLlmTest(cloned)) {
        (cloned as LlmTestConfig).models = [String(combo.model)];
      }

      return cloned;
    });

    const { matrix: _, ...rest } = suite;

    return {
      ...rest,
      name: `${suite.name}[${label}]`,
      tests,
      matrixValues: { ...combo },
    };
  });
}
