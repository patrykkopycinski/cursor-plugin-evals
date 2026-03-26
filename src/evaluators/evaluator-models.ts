export const EVALUATOR_MODEL_TIERS: Record<string, string[]> = {
  lightweight: [
    'keywords',
    'response-quality',
    'content-quality',
    'similarity',
  ],
};

const LIGHTWEIGHT_MODEL = 'gpt-5.2-mini';

export function resolveJudgeModel(
  evaluatorName: string,
  explicitModel?: string,
): string | undefined {
  if (explicitModel) return explicitModel;

  if (EVALUATOR_MODEL_TIERS.lightweight.includes(evaluatorName)) {
    return process.env.JUDGE_MODEL_LIGHTWEIGHT ?? LIGHTWEIGHT_MODEL;
  }

  return undefined;
}
