import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';

const QUALITY_DIMENSIONS = ['clarity', 'completeness', 'actionability'] as const;

function heuristicScore(text: string): number {
  let score = 0;
  const lines = text.split('\n');
  const headings = lines.filter((l) => l.startsWith('#'));
  const wordCount = text.split(/\s+/).length;

  if (wordCount >= 50) score += 0.2;
  if (wordCount >= 150) score += 0.1;
  if (headings.length >= 2) score += 0.2;
  if (headings.length >= 4) score += 0.1;

  const hasList = lines.some((l) => /^\s*[-*]\s/.test(l) || /^\s*\d+\.\s/.test(l));
  if (hasList) score += 0.15;

  const hasCodeBlock = text.includes('```');
  if (hasCodeBlock) score += 0.1;

  const hasConcreteWords = /(?:must|shall|always|never|ensure|verify|check)/i.test(text);
  if (hasConcreteWords) score += 0.15;

  return Math.min(1.0, score);
}

export class ContentQualityEvaluator implements Evaluator {
  readonly name = 'content-quality';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const text = context.finalOutput ?? context.prompt ?? '';

    if (!text || text.trim().length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'empty',
        explanation: 'No content to evaluate.',
      };
    }

    const score = heuristicScore(text);
    const threshold = (context.config?.['content-quality'] as number | undefined) ?? 0.6;

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low',
      explanation: `Content quality score: ${score.toFixed(2)} (heuristic). Word count: ${text.split(/\s+/).length}`,
      metadata: { wordCount: text.split(/\s+/).length, score },
    };
  }
}
