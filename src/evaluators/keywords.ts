import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';

export class KeywordsEvaluator implements Evaluator {
  name = 'keywords';
  kind: EvaluatorKind = 'CODE';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const expectedKeywords = context.expected?.responseContains ?? [];

    if (expectedKeywords.length === 0) {
      return {
        evaluator: this.name,
        score: 1,
        pass: true,
        label: 'no_keywords',
        explanation: 'No expected keywords specified',
      };
    }

    const output = (context.finalOutput ?? '').toLowerCase();
    const found: string[] = [];
    const missing: string[] = [];

    for (const kw of expectedKeywords) {
      if (output.includes(kw.toLowerCase())) {
        found.push(kw);
      } else {
        missing.push(kw);
      }
    }

    const score = found.length / expectedKeywords.length;
    const threshold = (context.config?.['keywords'] as number | undefined) ?? 0.7;

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= 1 ? 'all_found' : score >= 0.5 ? 'partial' : 'missing',
      explanation:
        missing.length > 0 ? `Missing keywords: ${missing.join(', ')}` : 'All keywords found',
      metadata: { found, missing },
    };
  }
}
