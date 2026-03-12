import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge } from './llm-judge.js';

interface Criterion {
  id: string;
  text: string;
  weight?: number;
}

interface CriterionResult {
  id: string;
  result: 'PASS' | 'FAIL';
  reason: string;
}

const DEFAULT_CRITERIA: Criterion[] = [
  { id: 'relevance', text: 'Response is relevant to the prompt', weight: 1 },
  { id: 'completeness', text: 'Response fully addresses the request', weight: 1 },
];

function buildSystemPrompt(criteria: Criterion[]): string {
  const criteriaList = criteria.map((c) => `- ${c.id}: ${c.text}`).join('\n');
  return `Evaluate the output against each criterion. For each, respond PASS or FAIL with a brief reason. Return JSON: {"criteria": [{"id": "<criterion_id>", "result": "PASS"|"FAIL", "reason": "<brief reason>"}]}

Criteria:
${criteriaList}`;
}

export class CriteriaEvaluator implements Evaluator {
  name = 'criteria';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const criteria = (context.config?.criteria as Criterion[] | undefined) ?? DEFAULT_CRITERIA;

    const userPrompt = [
      context.prompt ? `Prompt: ${context.prompt}` : '',
      `Output: ${context.finalOutput ?? '(empty)'}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const result = await callJudge({
        systemPrompt: buildSystemPrompt(criteria),
        userPrompt,
      });

      let criteriaResults: CriterionResult[];
      try {
        const jsonMatch = result.explanation.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.explanation) as {
          criteria?: CriterionResult[];
        };
        criteriaResults = parsed.criteria ?? [];
      } catch {
        criteriaResults = [];
      }

      const resultMap = new Map(criteriaResults.map((r) => [r.id, r]));

      let passedWeight = 0;
      let totalWeight = 0;
      const details: Array<{ id: string; result: string; reason: string; weight: number }> = [];

      for (const c of criteria) {
        const weight = c.weight ?? 1;
        totalWeight += weight;
        const cr = resultMap.get(c.id);
        const passed = cr?.result === 'PASS';
        if (passed) passedWeight += weight;
        details.push({
          id: c.id,
          result: cr?.result ?? 'UNKNOWN',
          reason: cr?.reason ?? 'No result from judge',
          weight,
        });
      }

      const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 1000) / 1000 : 0;
      const threshold = (context.config?.threshold as number | undefined) ?? 0.7;

      return {
        evaluator: this.name,
        score,
        pass: score >= threshold,
        label: score >= threshold ? 'pass' : 'fail',
        explanation: details.map((d) => `${d.id}: ${d.result} — ${d.reason}`).join('; '),
        metadata: { criteria: details, threshold },
      };
    } catch (err) {
      return {
        evaluator: this.name,
        score: 0,
        pass: false,
        label: 'error',
        explanation: `Judge call failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
