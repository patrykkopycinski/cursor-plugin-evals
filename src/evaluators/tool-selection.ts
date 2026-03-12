import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[-_\s.]/g, '');
}

function fuzzyMatch(expected: string, actual: string): boolean {
  const ne = normalizeToolName(expected);
  const na = normalizeToolName(actual);
  if (ne === na) return true;
  if (na.includes(ne) || ne.includes(na)) return true;
  return false;
}

export class ToolSelectionEvaluator implements Evaluator {
  readonly name = 'tool-selection';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const threshold =
      (context.config?.['threshold'] as number | undefined) ?? 0.8;
    const expectedTools = context.expected?.tools;

    if (!expectedTools || expectedTools.length === 0) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'skip',
        explanation: 'No expected tools specified; skipping evaluation.',
      };
    }

    const actualTools = context.toolCalls.map((tc) => tc.tool);
    const uniqueActual = [...new Set(actualTools)];

    const matched = new Set<string>();
    const matchedActual = new Set<string>();

    for (const exp of expectedTools) {
      for (const act of uniqueActual) {
        if (!matchedActual.has(act) && fuzzyMatch(exp, act)) {
          matched.add(exp);
          matchedActual.add(act);
          break;
        }
      }
    }

    const truePositives = matched.size;
    const falseNegatives = expectedTools.length - truePositives;
    const falsePositives = uniqueActual.length - matchedActual.size;

    const precision =
      truePositives + falsePositives > 0
        ? truePositives / (truePositives + falsePositives)
        : 0;
    const recall =
      truePositives + falseNegatives > 0
        ? truePositives / (truePositives + falseNegatives)
        : 0;
    const f1 =
      precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;

    const score = Math.round(f1 * 1000) / 1000;
    const missing = expectedTools.filter((t) => !matched.has(t));
    const extra = uniqueActual.filter((t) => !matchedActual.has(t));

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= threshold ? 'pass' : 'fail',
      explanation:
        `F1=${score.toFixed(3)} (precision=${precision.toFixed(3)}, recall=${recall.toFixed(3)}). ` +
        `Matched ${truePositives}/${expectedTools.length} expected tools.` +
        (missing.length > 0 ? ` Missing: [${missing.join(', ')}].` : '') +
        (extra.length > 0 ? ` Extra: [${extra.join(', ')}].` : ''),
      metadata: {
        precision,
        recall,
        f1,
        matched: [...matched],
        missing,
        extra,
        threshold,
      },
    };
  }
}
