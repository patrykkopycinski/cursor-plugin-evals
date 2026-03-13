import { loadConfig } from '../core/config.js';
import { runEvaluation } from '../core/runner.js';
import type { EvalConfig, SuiteConfig, LlmTestConfig } from '../core/types.js';
import { generateVariants } from './variants.js';

export interface SensitivityResult {
  testName: string;
  originalPrompt: string;
  variants: Array<{ prompt: string; scores: Record<string, number> }>;
  variance: number;
  isFragile: boolean;
}

function computeVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSqDiff = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return sumSqDiff / values.length;
}

export async function analyzeSensitivity(
  config: EvalConfig,
  suiteName: string,
  variantCount = 5,
  threshold = 0.15,
): Promise<SensitivityResult[]> {
  const suite = config.suites.find((s) => s.name === suiteName);
  if (!suite) {
    throw new Error(`Suite "${suiteName}" not found in config`);
  }

  if (suite.layer !== 'llm') {
    throw new Error(`Prompt sensitivity only works on llm-layer suites (got "${suite.layer}")`);
  }

  const llmTests = suite.tests.filter(
    (t): t is LlmTestConfig => 'prompt' in t && 'evaluators' in t,
  );

  const results: SensitivityResult[] = [];

  for (const test of llmTests) {
    const variants = await generateVariants(test.prompt, variantCount);
    const allPrompts = [test.prompt, ...variants];
    const variantResults: SensitivityResult['variants'] = [];

    for (const prompt of allPrompts) {
      const modifiedSuite: SuiteConfig = {
        ...suite,
        tests: [{ ...test, prompt }],
      };

      const modifiedConfig: EvalConfig = {
        ...config,
        suites: [modifiedSuite],
      };

      const runResult = await runEvaluation(modifiedConfig, {
        suites: [modifiedSuite.name],
      });

      const scores: Record<string, number> = {};
      for (const suiteResult of runResult.suites) {
        for (const testResult of suiteResult.tests) {
          for (const er of testResult.evaluatorResults) {
            scores[er.evaluator] = er.score;
          }
        }
      }

      variantResults.push({ prompt, scores });
    }

    const allScoreValues = variantResults.flatMap((v) => Object.values(v.scores));
    const variance = computeVariance(allScoreValues);

    results.push({
      testName: test.name,
      originalPrompt: test.prompt,
      variants: variantResults,
      variance,
      isFragile: variance > threshold,
    });
  }

  return results;
}
