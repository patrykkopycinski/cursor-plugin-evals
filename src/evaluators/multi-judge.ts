export type AggregationMethod = 'majority_vote' | 'borda_count' | 'weighted_average' | 'median';

export interface JudgeConfig {
  model: string;
  weight?: number;
  isSupremeJudge?: boolean;
}

export interface JudgeVerdict {
  judgeModel: string;
  score: number;
  label: string | null;
  explanation: string;
  latencyMs: number;
  costUsd: number | null;
}

export interface MultiJudgeResult {
  aggregatedScore: number;
  aggregatedLabel: string | null;
  verdicts: JudgeVerdict[];
  aggregationMethod: AggregationMethod;
  agreement: number;
  blindMode: boolean;
  metadata: {
    judgeCount: number;
    supremeJudgeCount: number;
    scoreVariance: number;
    minScore: number;
    maxScore: number;
  };
}

export interface MultiJudgeConfig {
  judges: JudgeConfig[];
  aggregation: AggregationMethod;
  blind: boolean;
  supremeCourtEnabled: boolean;
}

export const DEFAULT_MULTI_JUDGE_CONFIG: MultiJudgeConfig = {
  judges: [
    { model: 'gpt-5.2', weight: 1.0 },
    { model: 'claude-opus-4-6', weight: 1.0 },
    { model: 'gemini-3.1-pro', weight: 1.0 },
  ],
  aggregation: 'borda_count',
  blind: true,
  supremeCourtEnabled: false,
};

export function aggregateByMajorityVote(verdicts: JudgeVerdict[], threshold = 0.5): number {
  if (verdicts.length === 0) return 0;
  const passing = verdicts.filter((v) => v.score >= threshold).length;
  return passing / verdicts.length;
}

export function aggregateByBordaCount(
  verdicts: JudgeVerdict[],
  weights?: Map<string, number>,
): number {
  const n = verdicts.length;
  if (n === 0) return 0;
  if (n === 1) return verdicts[0].score;

  const sorted = [...verdicts].sort((a, b) => b.score - a.score);

  let totalPoints = 0;
  let maxPoints = 0;

  for (let rank = 0; rank < sorted.length; rank++) {
    const v = sorted[rank];
    const basePoints = n - 1 - rank;
    const w = weights?.get(v.judgeModel) ?? 1;
    totalPoints += basePoints * w;
    maxPoints += (n - 1) * w;
  }

  return maxPoints > 0 ? totalPoints / maxPoints : 0;
}

export function aggregateByWeightedAverage(
  verdicts: JudgeVerdict[],
  weights: Map<string, number>,
): number {
  if (verdicts.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const v of verdicts) {
    const w = weights.get(v.judgeModel) ?? 1;
    weightedSum += v.score * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

export function aggregateByMedian(verdicts: JudgeVerdict[]): number {
  if (verdicts.length === 0) return 0;

  const sorted = [...verdicts].map((v) => v.score).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function computeAgreement(verdicts: JudgeVerdict[], binSize = 0.1): number {
  if (verdicts.length <= 1) return 1;

  const bins = new Map<number, number>();
  for (const v of verdicts) {
    const bin = Math.floor(v.score / binSize);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }

  let maxCount = 0;
  for (const count of bins.values()) {
    if (count > maxCount) maxCount = count;
  }

  return maxCount / verdicts.length;
}

function computeVariance(verdicts: JudgeVerdict[]): number {
  if (verdicts.length === 0) return 0;
  const scores = verdicts.map((v) => v.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sumSqDiff = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0);
  return sumSqDiff / scores.length;
}

function buildWeightsMap(config: MultiJudgeConfig): Map<string, number> {
  const weights = new Map<string, number>();
  for (const judge of config.judges) {
    let w = judge.weight ?? 1;
    if (config.supremeCourtEnabled && judge.isSupremeJudge) {
      w *= 2;
    }
    weights.set(judge.model, w);
  }
  return weights;
}

function aggregateScore(
  method: AggregationMethod,
  verdicts: JudgeVerdict[],
  weights: Map<string, number>,
): number {
  switch (method) {
    case 'majority_vote':
      return aggregateByMajorityVote(verdicts);
    case 'borda_count':
      return aggregateByBordaCount(verdicts, weights);
    case 'weighted_average':
      return aggregateByWeightedAverage(verdicts, weights);
    case 'median':
      return aggregateByMedian(verdicts);
  }
}

function pickLabel(verdicts: JudgeVerdict[]): string | null {
  const labels = verdicts.map((v) => v.label).filter((l): l is string => l !== null);
  if (labels.length === 0) return null;

  const counts = new Map<string, number>();
  for (const l of labels) {
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

export async function runMultiJudgeEvaluation(
  evaluatorFn: (model: string) => Promise<{
    score: number;
    label: string | null;
    explanation: string;
    latencyMs: number;
    costUsd: number | null;
  }>,
  config: MultiJudgeConfig,
): Promise<MultiJudgeResult> {
  const verdicts = await Promise.all(
    config.judges.map(async (judge) => {
      const result = await evaluatorFn(judge.model);
      return {
        judgeModel: judge.model,
        ...result,
      } satisfies JudgeVerdict;
    }),
  );

  const weights = buildWeightsMap(config);
  const aggregatedScore = aggregateScore(config.aggregation, verdicts, weights);
  const agreement = computeAgreement(verdicts);
  const scores = verdicts.map((v) => v.score);

  return {
    aggregatedScore,
    aggregatedLabel: pickLabel(verdicts),
    verdicts,
    aggregationMethod: config.aggregation,
    agreement,
    blindMode: config.blind,
    metadata: {
      judgeCount: verdicts.length,
      supremeJudgeCount: config.judges.filter((j) => j.isSupremeJudge).length,
      scoreVariance: computeVariance(verdicts),
      minScore: scores.length > 0 ? Math.min(...scores) : 0,
      maxScore: scores.length > 0 ? Math.max(...scores) : 0,
    },
  };
}

export type MultiJudgeTier = 'fast' | 'balanced' | 'thorough';

export const MULTI_JUDGE_TIERS: Record<MultiJudgeTier, MultiJudgeConfig> = {
  fast: {
    judges: [{ model: 'gpt-5.2-mini', weight: 1.0 }],
    aggregation: 'weighted_average',
    blind: true,
    supremeCourtEnabled: false,
  },
  balanced: {
    judges: [
      { model: 'gpt-5.2', weight: 1.0 },
      { model: 'gemini-2.5-flash', weight: 1.0 },
    ],
    aggregation: 'weighted_average',
    blind: true,
    supremeCourtEnabled: false,
  },
  thorough: DEFAULT_MULTI_JUDGE_CONFIG,
};

export function resolveMultiJudgeConfig(tier?: MultiJudgeTier | string): MultiJudgeConfig {
  if (!tier) return DEFAULT_MULTI_JUDGE_CONFIG;
  return MULTI_JUDGE_TIERS[tier as MultiJudgeTier] ?? DEFAULT_MULTI_JUDGE_CONFIG;
}
