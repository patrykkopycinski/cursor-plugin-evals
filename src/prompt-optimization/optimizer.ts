import { callJudge } from '../evaluators/llm-judge.js';
import { runEvaluation } from '../core/runner.js';
import type { EvalConfig, SuiteConfig, LlmTestConfig } from '../core/types.js';

export interface OptimizationConfig {
  suite: string;
  targetEvaluator: string;
  maxIterations?: number;
  variantsPerIteration?: number;
  targetScore?: number;
}

export interface OptimizationResult {
  originalPrompt: string;
  optimizedPrompt: string;
  originalScore: number;
  optimizedScore: number;
  improvement: number;
  iterations: number;
  history: Array<{ iteration: number; prompt: string; score: number }>;
}

const VARIANT_SYSTEM_PROMPT = `You are an expert prompt engineer. Given a system prompt or tool description and its current evaluation score, generate improved variants.

Focus on:
- Clarity of instructions
- Adding concrete examples where helpful
- Better structure and formatting
- More precise language
- Removing ambiguity

Respond ONLY with a JSON array of strings, each being a full replacement prompt. No explanation, no markdown fences.`;

function buildVariantUserPrompt(
  currentPrompt: string,
  currentScore: number,
  count: number,
): string {
  return `The following prompt scored ${currentScore.toFixed(3)} out of 1.0 on evaluations. Generate ${count} improved variants that might score higher.

Current prompt:
"""
${currentPrompt}
"""

Return a JSON array of ${count} string variants.`;
}

export async function generatePromptVariants(
  currentPrompt: string,
  currentScore: number,
  count: number,
): Promise<string[]> {
  if (count < 1) return [];

  const result = await callJudge({
    systemPrompt: VARIANT_SYSTEM_PROMPT,
    userPrompt: buildVariantUserPrompt(currentPrompt, currentScore, count),
  });

  const raw = result.explanation || '';
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        return parsed.slice(0, count);
      }
    } catch {
      // fall through to line-based parsing
    }
  }

  return raw
    .split('\n')
    .map((line) =>
      line
        .replace(/^\d+[.)]\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .slice(0, count);
}

async function evaluatePrompt(
  prompt: string,
  suite: SuiteConfig,
  config: EvalConfig,
  targetEvaluator: string,
): Promise<number> {
  const llmTests = suite.tests.filter(
    (t): t is LlmTestConfig => 'prompt' in t && 'evaluators' in t,
  );

  if (llmTests.length === 0) return 0;

  const modifiedTests = llmTests.map((test) => ({
    ...test,
    system: prompt,
  }));

  const modifiedSuite: SuiteConfig = {
    ...suite,
    tests: modifiedTests,
  };

  const modifiedConfig: EvalConfig = {
    ...config,
    suites: [modifiedSuite],
  };

  const runResult = await runEvaluation(modifiedConfig, {
    suites: [modifiedSuite.name],
  });

  const scores: number[] = [];
  for (const suiteResult of runResult.suites) {
    for (const testResult of suiteResult.tests) {
      for (const er of testResult.evaluatorResults) {
        if (er.evaluator === targetEvaluator) {
          scores.push(er.score);
        }
      }
    }
  }

  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function extractCurrentPrompt(suite: SuiteConfig): string {
  const llmTests = suite.tests.filter(
    (t): t is LlmTestConfig => 'prompt' in t && 'evaluators' in t,
  );
  return llmTests[0]?.system ?? '';
}

export async function optimizePrompt(
  config: EvalConfig,
  optimizationConfig: OptimizationConfig,
): Promise<OptimizationResult> {
  const {
    suite: suiteName,
    targetEvaluator,
    maxIterations = 5,
    variantsPerIteration = 3,
    targetScore = 0.95,
  } = optimizationConfig;

  const suite = config.suites.find((s) => s.name === suiteName);
  if (!suite) {
    throw new Error(`Suite "${suiteName}" not found in config`);
  }

  if (suite.layer !== 'llm') {
    throw new Error(`Prompt optimization only works on llm-layer suites (got "${suite.layer}")`);
  }

  const originalPrompt = extractCurrentPrompt(suite);
  const originalScore = await evaluatePrompt(originalPrompt, suite, config, targetEvaluator);

  const history: OptimizationResult['history'] = [
    { iteration: 0, prompt: originalPrompt, score: originalScore },
  ];

  let bestPrompt = originalPrompt;
  let bestScore = originalScore;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (bestScore >= targetScore) break;

    const variants = await generatePromptVariants(bestPrompt, bestScore, variantsPerIteration);

    for (const variant of variants) {
      const score = await evaluatePrompt(variant, suite, config, targetEvaluator);
      history.push({ iteration, prompt: variant, score });

      if (score > bestScore) {
        bestScore = score;
        bestPrompt = variant;
      }

      if (bestScore >= targetScore) break;
    }
  }

  const lastIteration = history[history.length - 1]?.iteration ?? 0;

  return {
    originalPrompt,
    optimizedPrompt: bestPrompt,
    originalScore,
    optimizedScore: bestScore,
    improvement: bestScore - originalScore,
    iterations: lastIteration,
    history,
  };
}
