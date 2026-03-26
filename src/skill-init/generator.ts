import { callJudge } from '../evaluators/llm-judge.js';
import type { SkillProfile } from './analyzer.js';

export interface GeneratedTest {
  name: string;
  prompt: string;
  expected: {
    response_contains?: string[];
    response_not_contains?: string[];
    tools?: string[];
  };
  difficulty: 'simple' | 'moderate' | 'complex';
  category: 'happy-path' | 'edge-case' | 'boundary' | 'negative';
}

export interface GeneratedEval {
  name: string;
  description: string;
  evaluators: string[];
  tests: GeneratedTest[];
  defaults: {
    timeout: number;
    repetitions: number;
    thresholds: Record<string, number>;
  };
}

const DEFAULT_THRESHOLDS: Record<string, number> = {
  correctness: 0.7,
  keywords: 0.6,
  script: 0.5,
  'tool-selection': 0.8,
  'plan-quality': 0.6,
};

export function selectEvaluators(profile: SkillProfile): string[] {
  const evals: string[] = ['correctness'];
  if (profile.keyDomainTerms.length > 0) evals.push('keywords');
  if (profile.hasCodeOutput) evals.push('script');
  if (profile.expectedTools.length > 0) evals.push('tool-selection');
  if (profile.complexity === 'complex') evals.push('plan-quality');
  return evals;
}

export function selectThresholds(evaluators: string[]): Record<string, number> {
  const thresholds: Record<string, number> = {};
  for (const name of evaluators) {
    if (DEFAULT_THRESHOLDS[name] !== undefined) {
      thresholds[name] = DEFAULT_THRESHOLDS[name];
    }
  }
  return thresholds;
}

const GENERATOR_SYSTEM_PROMPT = `You are an expert test designer for AI agent skills. Given a skill profile, generate 5-8 diverse test cases. Respond with ONLY a JSON object:

{
  "tests": [
    {
      "name": "kebab-case-test-name",
      "prompt": "The natural language instruction to test",
      "expected": {
        "response_contains": ["keywords that should appear in a correct response"],
        "response_not_contains": ["keywords that should NOT appear (optional)"],
        "tools": ["expected tool names (optional)"]
      },
      "difficulty": "simple | moderate | complex",
      "category": "happy-path | edge-case | boundary | negative"
    }
  ]
}

Distribution: 3 happy-path, 2 edge-case, 1 boundary, 1 negative (minimum 5, max 8).
Make tests realistic and domain-specific. Each test should exercise a different capability.`;

export async function generateEval(profile: SkillProfile, model?: string): Promise<GeneratedEval> {
  const evaluators = selectEvaluators(profile);
  const thresholds = selectThresholds(evaluators);

  const response = await callJudge({
    systemPrompt: GENERATOR_SYSTEM_PROMPT,
    userPrompt: JSON.stringify(profile, null, 2),
    model,
  });

  const jsonMatch = response.explanation.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse generated tests from LLM: ${response.explanation.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as { tests: GeneratedTest[] };
  if (!Array.isArray(parsed.tests) || parsed.tests.length === 0) {
    throw new Error('LLM returned no tests');
  }

  return {
    name: profile.name,
    description: `Evaluates: ${profile.purpose}`,
    evaluators,
    tests: parsed.tests,
    defaults: {
      timeout: 120_000,
      repetitions: 1,
      thresholds,
    },
  };
}
