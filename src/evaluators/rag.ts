import type { Evaluator, EvaluatorContext, EvaluatorResult } from '../core/types.js';

function extractRetrievedDocIds(context: EvaluatorContext): string[] {
  const ids: string[] = [];
  for (const tc of context.toolCalls) {
    for (const content of tc.result.content) {
      if (content.type !== 'text' || !content.text) continue;
      try {
        const parsed = JSON.parse(content.text) as unknown;
        if (Array.isArray(parsed)) {
          for (const doc of parsed) {
            if (typeof doc === 'object' && doc !== null && 'id' in doc) {
              ids.push(String((doc as { id: unknown }).id));
            }
          }
        } else if (typeof parsed === 'object' && parsed !== null && 'id' in parsed) {
          ids.push(String((parsed as { id: unknown }).id));
        }
      } catch {
        // Not JSON — try extracting doc-like identifiers from text
        const matches = content.text.match(/\bid["\s:=]+["']?([^"'\s,}\]]+)/gi);
        if (matches) {
          for (const m of matches) {
            const val = m.replace(/^id["\s:=]+["']?/i, '').replace(/["']$/, '');
            if (val) ids.push(val);
          }
        }
      }
    }
  }
  return ids;
}

export class RagEvaluator implements Evaluator {
  readonly name = 'rag';
  readonly kind = 'CODE' as const;

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const k = (context.config?.k as number | undefined) ?? 5;
    const relevanceThreshold = (context.config?.relevanceThreshold as number | undefined) ?? 0.5;
    const groundTruth = context.expected?.responseContains;

    if (!groundTruth || groundTruth.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'no-ground-truth',
        explanation: 'No ground truth document IDs provided in expected.responseContains.',
        metadata: { relevanceThreshold },
      };
    }

    const retrieved = extractRetrievedDocIds(context);
    const topK = retrieved.slice(0, k);

    const groundTruthSet = new Set(groundTruth.map((id) => id.toLowerCase()));
    const hits = topK.filter((id) => groundTruthSet.has(id.toLowerCase())).length;
    const totalRelevant = groundTruth.length;

    const precision = k > 0 ? hits / k : 0;
    const recall = totalRelevant > 0 ? hits / totalRelevant : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const score = Math.round(f1 * 1000) / 1000;

    const threshold = (context.config?.threshold as number | undefined) ?? 0.7;

    return {
      evaluator: this.name,
      score,
      pass: score >= threshold,
      label: score >= threshold ? 'pass' : 'fail',
      explanation:
        `F1@${k}=${score.toFixed(3)} (Precision@${k}=${precision.toFixed(3)}, Recall@${k}=${recall.toFixed(3)}). ` +
        `${hits}/${totalRelevant} relevant docs found in top-${k}.`,
      metadata: { precision, recall, f1, hits, k, totalRelevant, relevanceThreshold },
    };
  }
}
