import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge, handleJudgeError } from './llm-judge.js';

export const LABEL_FLOORS: Record<string, number> = {
  CORRECT: 0.8,
  PARTIALLY_CORRECT: 0.5,
  NOT_IN_GROUND_TRUTH: 0.5,
  INCORRECT: 0.2,
  WRONG: 0.1,
};

export interface ClaimVerdict {
  claim: string;
  centrality: 'core' | 'supporting' | 'peripheral';
  verdict: 'supported' | 'partially_supported' | 'not_addressed' | 'contradicted';
  explanation: string;
}

export interface LabelAwareScoringConfig {
  centralityWeights?: { core: number; supporting: number; peripheral: number };
  verdictScores?: Record<string, number>;
  labelFloors?: Record<string, number>;
}

const DEFAULT_CENTRALITY_WEIGHTS = { core: 1.0, supporting: 0.6, peripheral: 0.3 };

const DEFAULT_VERDICT_SCORES: Record<string, number> = {
  supported: 1.0,
  partially_supported: 0.5,
  not_addressed: 0.0,
  contradicted: -0.5,
};

const SYSTEM_PROMPT = `You are an evaluation judge. Score the output for correctness relative to the expected output.

Respond ONLY with valid JSON:
{
  "score": <0.0-1.0>,
  "label": "<CORRECT|PARTIALLY_CORRECT|NOT_IN_GROUND_TRUTH|INCORRECT|WRONG>",
  "explanation": "<brief reasoning>"
}

Scoring guidelines:
- CORRECT (0.8-1.0): Output correctly addresses the prompt and matches expected output
- PARTIALLY_CORRECT (0.5-0.79): Output is partially correct but missing key elements
- NOT_IN_GROUND_TRUTH (0.5-0.7): Output is correct but addresses aspects not in expected output
- INCORRECT (0.1-0.49): Output is wrong or misleading
- WRONG (0.0-0.1): Output is completely wrong or harmful`;

const CLAIM_SYSTEM_PROMPT = `You are an evaluation judge. Decompose the expected output into individual claims and evaluate each against the actual output.

Respond ONLY with valid JSON:
{
  "score": <0.0-1.0>,
  "label": "<CORRECT|PARTIALLY_CORRECT|NOT_IN_GROUND_TRUTH|INCORRECT|WRONG>",
  "explanation": "<brief reasoning>",
  "claims": [
    {
      "claim": "<the specific claim being verified>",
      "centrality": "<core|supporting|peripheral>",
      "verdict": "<supported|partially_supported|not_addressed|contradicted>",
      "explanation": "<why this verdict>"
    }
  ]
}

Centrality definitions:
- core: Essential claim that must be correct for the answer to be useful
- supporting: Important but not essential — adds value when correct
- peripheral: Nice-to-have detail that doesn't affect overall correctness

Verdict definitions:
- supported: The claim is clearly confirmed by the actual output
- partially_supported: The claim is partially addressed or implied
- not_addressed: The claim is neither confirmed nor denied
- contradicted: The actual output directly contradicts this claim`;

/**
 * Score claims using centrality-weighted verdict scoring.
 * Returns a score in [0, 1] clamped by the label floor.
 */
export function scoreClaimsWeighted(
  claims: ClaimVerdict[],
  label: string,
  config?: LabelAwareScoringConfig,
): number {
  if (claims.length === 0) {
    return LABEL_FLOORS[label] ?? 0;
  }

  const cWeights = config?.centralityWeights ?? DEFAULT_CENTRALITY_WEIGHTS;
  const vScores = config?.verdictScores ?? DEFAULT_VERDICT_SCORES;
  const floors = config?.labelFloors ?? LABEL_FLOORS;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const claim of claims) {
    const cWeight = cWeights[claim.centrality] ?? 0.5;
    const vScore = vScores[claim.verdict] ?? 0;
    weightedSum += cWeight * vScore;
    totalWeight += cWeight;
  }

  const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const normalizedScore = Math.max(0, Math.min(1, rawScore));
  const floor = floors[label] ?? 0;

  return Math.max(normalizedScore, floor);
}

export class CorrectnessEvaluator implements Evaluator {
  name = 'correctness';
  kind: EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const expected =
      context.expected?.responseContains?.join(', ') ?? JSON.stringify(context.expected ?? {});

    const useLabelAware =
      ((context.config?.['label_aware_scoring'] ?? context.config?.['labelAwareScoring']) as boolean | undefined) === true;

    const systemPrompt = useLabelAware ? CLAIM_SYSTEM_PROMPT : SYSTEM_PROMPT;

    const userPrompt = [
      `Prompt: ${context.prompt ?? '(none)'}`,
      `Expected: ${expected}`,
      `Actual output: ${context.finalOutput ?? '(empty)'}`,
      context.toolCalls.length > 0
        ? `Tools called: ${context.toolCalls.map((t) => t.tool).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const result = await callJudge({ systemPrompt, userPrompt });
      const claims = (result as unknown as Record<string, unknown>).claims as ClaimVerdict[] | undefined;
      const scoringConfig = (context.config?.['scoring_config'] ?? context.config?.['scoringConfig']) as
        | LabelAwareScoringConfig
        | undefined;

      let score: number;
      if (useLabelAware && claims && claims.length > 0) {
        score = scoreClaimsWeighted(claims, result.label, scoringConfig);
      } else {
        const floor = LABEL_FLOORS[result.label] ?? 0;
        score = Math.max(result.score, floor);
      }

      const threshold = (context.config?.['correctness'] as number | undefined) ?? 0.7;

      return {
        evaluator: this.name,
        score,
        pass: score >= threshold,
        label: result.label,
        explanation: result.explanation,
        metadata: claims ? { claims, claimCount: claims.length } : undefined,
      };
    } catch (err) {
      return handleJudgeError(this.name, err);
    }
  }
}
