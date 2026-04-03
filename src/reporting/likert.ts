/**
 * Likert scale transformation.
 *
 * The RFC specifies a 0-5 Likert scale for accuracy scoring:
 *   5 = Perfect semantic match
 *   4 = Highly accurate; minor deviation
 *   3 = Generally correct; some flaws
 *   2 = Partially correct; significant errors
 *   1 = Mostly incorrect; minimal relevance
 *   0 = Completely incorrect or failed
 *
 * Internally all scores use 0.0-1.0. When --likert is passed, this module
 * transforms a RunResult so that all evaluator scores are scaled to 0-5
 * for display purposes.
 */

import type { RunResult, SuiteResult, TestResult, EvaluatorResult } from '../core/types.js';

export interface ReportOptions {
  likert?: boolean;
}

const LIKERT_MAX = 5;

function scaleScore(score: number): number {
  return Math.round(score * LIKERT_MAX * 100) / 100;
}

function transformEvaluatorResult(er: EvaluatorResult): EvaluatorResult {
  return { ...er, score: scaleScore(er.score) };
}

function transformTest(test: TestResult): TestResult {
  return {
    ...test,
    evaluatorResults: test.evaluatorResults.map(transformEvaluatorResult),
  };
}

function transformSuite(suite: SuiteResult): SuiteResult {
  const tests = suite.tests.map(transformTest);

  const scaledSummary: SuiteResult['evaluatorSummary'] = {};
  for (const [name, s] of Object.entries(suite.evaluatorSummary)) {
    scaledSummary[name] = {
      mean: scaleScore(s.mean),
      min: scaleScore(s.min),
      max: scaleScore(s.max),
      pass: s.pass,
      total: s.total,
    };
  }

  return { ...suite, tests, evaluatorSummary: scaledSummary };
}

/**
 * Transform a RunResult so all evaluator scores are on a 0-5 Likert scale.
 * This is a pure presentation transformation — no mutation of the original.
 */
export function transformToLikert(result: RunResult): RunResult {
  return {
    ...result,
    suites: result.suites.map(transformSuite),
  };
}
