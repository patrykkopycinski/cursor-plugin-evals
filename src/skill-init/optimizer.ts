import type { EvalYamlPatch } from './recommendations.js';

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export function applyPatches(
  yaml: Record<string, unknown>,
  patches: EvalYamlPatch[],
): Record<string, unknown> {
  const result = structuredClone(yaml);

  for (const patch of patches) {
    switch (patch.op) {
      case 'set_threshold':
      case 'set_repetitions':
        setNestedValue(result, patch.path, patch.value);
        break;

      case 'add_evaluator': {
        if (!Array.isArray(result.evaluators)) result.evaluators = [];
        const evals = result.evaluators as string[];
        if (!evals.includes(patch.value as string)) {
          evals.push(patch.value as string);
        }
        break;
      }

      case 'remove_evaluator': {
        if (Array.isArray(result.evaluators)) {
          result.evaluators = (result.evaluators as string[]).filter(
            (e) => e !== patch.value,
          );
        }
        break;
      }

      case 'add_test':
        break;
    }
  }

  return result;
}
