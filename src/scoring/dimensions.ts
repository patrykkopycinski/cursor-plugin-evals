import type { RunResult, SuiteResult } from '../core/types.js';

export type Difficulty = 'simple' | 'moderate' | 'complex' | 'adversarial';

export interface DimensionScores {
  structure: number;
  correctness: number;
  security: number;
  performance: number;
  agentReadiness: number;
}

function layerPassRate(suites: SuiteResult[], layers: string[]): number {
  const matching = suites.filter((s) => layers.includes(s.layer));
  if (matching.length === 0) return 1.0;

  const tests = matching.flatMap((s) => s.tests);
  if (tests.length === 0) return 1.0;

  const passed = tests.filter((t) => t.pass).length;
  return passed / tests.length;
}

function evaluatorMeanFromSuites(suites: SuiteResult[], evaluatorNames: string[]): number {
  const scores: number[] = [];

  for (const suite of suites) {
    for (const name of evaluatorNames) {
      const summary = suite.evaluatorSummary[name];
      if (summary) scores.push(summary.mean);
    }
  }

  if (scores.length === 0) return 1.0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function weightedPassRate(
  suites: SuiteResult[],
  layers: string[],
  evaluatorNames: string[],
): number {
  const passRate = layerPassRate(suites, layers);
  const evalMean = evaluatorMeanFromSuites(
    suites.filter((s) => layers.includes(s.layer)),
    evaluatorNames,
  );

  return passRate * 0.6 + evalMean * 0.4;
}

const DIFFICULTY_WEIGHT: Record<Difficulty, number> = {
  simple: 1.0,
  moderate: 1.0,
  complex: 1.5,
  adversarial: 1.5,
};

export function getDifficultyWeight(difficulty?: Difficulty): number {
  if (!difficulty) return 1.0;
  return DIFFICULTY_WEIGHT[difficulty];
}

export function computeDimensions(result: RunResult): DimensionScores {
  const { suites } = result;

  const structure = layerPassRate(suites, ['static']);

  const correctness = weightedPassRate(
    suites,
    ['unit', 'integration'],
    ['tool-args', 'response-quality'],
  );

  const security = evaluatorMeanFromSuites(suites, ['security', 'tool-poisoning']);

  const performance = layerPassRate(suites, ['performance']);

  const llmSuites = suites.filter((s) => s.layer === 'llm');
  if (llmSuites.length === 0) {
    return { structure, correctness, security, performance, agentReadiness: 1.0 };
  }

  const llmTests = llmSuites.flatMap((s) => s.tests);
  if (llmTests.length === 0) {
    return { structure, correctness, security, performance, agentReadiness: 1.0 };
  }

  let weightedPassSum = 0;
  let totalWeight = 0;

  for (const test of llmTests) {
    const difficulty = (test as { difficulty?: Difficulty }).difficulty;
    const weight = getDifficultyWeight(difficulty);
    weightedPassSum += (test.pass ? 1 : 0) * weight;
    totalWeight += weight;
  }

  const llmPassRate = totalWeight > 0 ? weightedPassSum / totalWeight : 1.0;
  const evalMean = evaluatorMeanFromSuites(llmSuites, ['tool-selection', 'response-quality']);

  const agentReadiness = llmPassRate * 0.6 + evalMean * 0.4;

  return { structure, correctness, security, performance, agentReadiness };
}
