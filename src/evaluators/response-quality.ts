import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';

export class ResponseQualityEvaluator implements Evaluator {
  readonly name = 'response-quality';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const threshold = (context.config?.['threshold'] as number | undefined) ?? 0.7;
    const output = context.finalOutput ?? '';
    const outputLower = output.toLowerCase();

    const containsPatterns = context.expected?.responseContains ?? [];
    const notContainsPatterns = context.expected?.responseNotContains ?? [];
    const totalChecks = containsPatterns.length + notContainsPatterns.length;

    if (totalChecks === 0) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'skip',
        explanation: 'No response content assertions specified; skipping evaluation.',
      };
    }

    const containsResults = containsPatterns.map((pattern) => ({
      pattern,
      type: 'contains' as const,
      pass: outputLower.includes(pattern.toLowerCase()),
    }));

    const notContainsResults = notContainsPatterns.map((pattern) => ({
      pattern,
      type: 'not_contains' as const,
      pass: !outputLower.includes(pattern.toLowerCase()),
    }));

    const allResults = [...containsResults, ...notContainsResults];
    const passed = allResults.filter((r) => r.pass).length;
    const score = Math.round((passed / totalChecks) * 1000) / 1000;

    const failures = allResults.filter((r) => !r.pass);

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= threshold ? 'pass' : 'fail',
      explanation:
        `${passed}/${totalChecks} response checks passed (score=${score.toFixed(3)}).` +
        (failures.length > 0
          ? ` Failures: ${failures.map((f) => `${f.type}("${f.pattern}")`).join(', ')}.`
          : ''),
      metadata: {
        totalChecks,
        passed,
        threshold,
        results: allResults,
      },
    };
  }
}
