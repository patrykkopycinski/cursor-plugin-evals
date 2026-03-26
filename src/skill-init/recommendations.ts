import { callJudge } from '../evaluators/llm-judge.js';
import type { RunResult } from '../core/types.js';

export interface EvalYamlPatch {
  op: 'add_evaluator' | 'remove_evaluator' | 'set_threshold' | 'add_test' | 'set_repetitions';
  path: string;
  value: unknown;
}

export interface Recommendation {
  type: 'evaluator' | 'threshold' | 'test' | 'config';
  priority: 'high' | 'medium' | 'low';
  message: string;
  action?: EvalYamlPatch;
}

export function computeDeterministicRecommendations(
  result: RunResult,
  evalYaml: Record<string, unknown>,
): Recommendation[] {
  const recs: Recommendation[] = [];

  const total = result.overall.total;
  const passed = result.overall.passed;
  const passRate = total > 0 ? passed / total : 0;

  // Suggest more repetitions when pass rate is perfect but repetitions is 1
  const defaults = evalYaml?.defaults as Record<string, unknown> | undefined;
  const repetitions = defaults?.repetitions;
  if (passRate === 1.0 && (repetitions === 1 || repetitions === undefined)) {
    recs.push({
      type: 'config',
      priority: 'medium',
      message: 'All tests pass — consider increasing repetitions to verify consistency',
      action: {
        op: 'set_repetitions',
        path: 'defaults.repetitions',
        value: 3,
      },
    });
  }

  // Warn when evaluator scores very low
  const allEvaluatorResults = result.suites.flatMap((s) =>
    s.tests.flatMap((t) => t.evaluatorResults),
  );
  const lowScoring = allEvaluatorResults.filter((e) => e.score < 0.3);
  if (lowScoring.length > 0) {
    recs.push({
      type: 'evaluator',
      priority: 'high',
      message: `Evaluator scores very low (below 0.3) — check evaluator configuration or test expectations`,
    });
  }

  // Suggest more tests when fewer than 5
  if (total < 5) {
    recs.push({
      type: 'test',
      priority: 'medium',
      message: 'Fewer than 5 tests — add more tests to improve coverage',
    });
  }

  // Suggest harder tests when all score 1.0 and there are at least 5 tests
  if (total >= 5 && passRate === 1.0) {
    const allScores = allEvaluatorResults.map((e) => e.score);
    const allPerfect = allScores.every((s) => s === 1.0);
    if (allPerfect) {
      recs.push({
        type: 'test',
        priority: 'low',
        message:
          'All tests score perfectly — tests may be too easy, consider adding adversarial cases',
      });
    }
  }

  return recs;
}

export async function computeLlmRecommendations(
  result: RunResult,
  skillContent: string,
  evalYamlContent: string,
  model?: string,
): Promise<Recommendation[]> {
  const testSummary = result.suites.flatMap((s) =>
    s.tests.map((t) => ({
      name: t.name,
      pass: t.pass,
      scores: Object.fromEntries(t.evaluatorResults.map((er) => [er.evaluator, er.score])),
    })),
  );

  const systemPrompt = `You are an expert at improving AI skill evaluations. Given:
1. The SKILL.md content (what the skill does)
2. The eval run results (which tests passed/failed and scores)
3. The current eval.yaml (test definitions)

Suggest 2-4 specific, actionable improvements. Respond with ONLY a JSON object:

{
  "recommendations": [
    {
      "type": "evaluator | threshold | test | config",
      "priority": "high | medium | low",
      "message": "Specific, actionable recommendation with concrete details"
    }
  ]
}

Focus on: coverage gaps, test quality, missing evaluators, threshold tuning, and concrete new test ideas with prompts.`;

  const userPrompt = [
    '## SKILL.md',
    skillContent.slice(0, 3000),
    '',
    '## Run Results',
    JSON.stringify({ passRate: result.overall.passRate, tests: testSummary }, null, 2),
    '',
    '## Current eval.yaml',
    evalYamlContent.slice(0, 3000),
  ].join('\n');

  try {
    const response = await callJudge({ systemPrompt, userPrompt, model });
    const jsonMatch = response.explanation.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as { recommendations: Recommendation[] };
    return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  } catch {
    return [];
  }
}
