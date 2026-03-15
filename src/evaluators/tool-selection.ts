import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[-_\s.]/g, '');
}

function fuzzyMatch(expected: string, actual: string): boolean {
  const ne = normalizeToolName(expected);
  const na = normalizeToolName(actual);
  if (ne === na) return true;

  const shorter = ne.length <= na.length ? ne : na;
  const longer = ne.length <= na.length ? na : ne;

  if (shorter.length < 4) return false;
  if (shorter.length / longer.length < 0.4) return false;

  return longer.includes(shorter);
}

export class ToolSelectionEvaluator implements Evaluator {
  readonly name = 'tool-selection';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const threshold = (context.config?.['threshold'] as number | undefined) ?? 0.8;
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
      truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
    const recall =
      truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;

    // Use F-beta with beta=2 (recall-weighted). LLMs often call extra relevant tools
    // which shouldn't be penalized as harshly as missing expected tools.
    const beta = 2;
    const betaSq = beta * beta;
    const fbeta =
      precision + recall > 0
        ? ((1 + betaSq) * precision * recall) / (betaSq * precision + recall)
        : 0;

    const score = Math.round(fbeta * 1000) / 1000;
    const missing = expectedTools.filter((t) => !matched.has(t));
    const extra = uniqueActual.filter((t) => !matchedActual.has(t));

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= threshold ? 'pass' : 'fail',
      explanation:
        `Fβ=${score.toFixed(3)} (precision=${precision.toFixed(3)}, recall=${recall.toFixed(3)}, β=2). ` +
        `Matched ${truePositives}/${expectedTools.length} expected tools.` +
        (missing.length > 0 ? ` Missing: [${missing.join(', ')}].` : '') +
        (extra.length > 0 ? ` Extra: [${extra.join(', ')}].` : ''),
      metadata: {
        precision,
        recall,
        fbeta,
        matched: [...matched],
        missing,
        extra,
        threshold,
      },
    };
  }
}
