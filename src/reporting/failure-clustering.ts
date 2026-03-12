export type FailureCategory =
  | 'wrong_tool_selection'
  | 'wrong_arguments'
  | 'wrong_ordering'
  | 'hallucination'
  | 'empty_response'
  | 'content_quality';

export interface FailureCluster {
  category: FailureCategory;
  count: number;
  testNames: string[];
  recommendedAction: string;
}

export interface TestResultForClustering {
  name: string;
  toolsCalled: string[];
  expected: { tools?: string[]; toolSequence?: string[] } | undefined;
  evaluators: Array<{ name: string; score: number | null; label: string | null }>;
}

const RECOMMENDED_ACTIONS: Record<FailureCategory, string> = {
  wrong_tool_selection: 'Review SKILL.md tool descriptions and \'when to use\' guidance',
  wrong_arguments: 'Add examples with correct argument patterns to SKILL.md',
  wrong_ordering: 'Add multi-step workflow examples showing correct sequence',
  hallucination: 'Add explicit constraints in SKILL.md; improve grounding examples',
  empty_response: 'Check tool script connectivity and timeout settings',
  content_quality: 'Improve expected descriptions; add more specific ground truth',
};

const EVALUATOR_CATEGORY_MAP: Record<string, FailureCategory> = {
  'tool-selection': 'wrong_tool_selection',
  'tool-args': 'wrong_arguments',
  'tool-sequence': 'wrong_ordering',
  groundedness: 'hallucination',
  correctness: 'hallucination',
  'response-quality': 'content_quality',
  'content-quality': 'content_quality',
};

function getScore(evaluators: TestResultForClustering['evaluators'], ...names: string[]): number | null {
  for (const name of names) {
    const ev = evaluators.find((e) => e.name === name);
    if (ev?.score != null) return ev.score;
  }
  return null;
}

function isEmptyResponse(test: TestResultForClustering): boolean {
  if (test.toolsCalled.length > 0) return false;
  if (test.evaluators.length === 0) return true;
  return test.evaluators.every((e) => e.score == null);
}

export function clusterFailures(
  tests: TestResultForClustering[],
  thresholds?: Record<string, number>,
): FailureCluster[] {
  const defaultThreshold = 0.7;
  const getThreshold = (evaluator: string) => thresholds?.[evaluator] ?? defaultThreshold;

  const buckets = new Map<FailureCategory, Set<string>>();

  for (const test of tests) {
    if (isEmptyResponse(test)) {
      const set = buckets.get('empty_response') ?? new Set();
      set.add(test.name);
      buckets.set('empty_response', set);
    }

    for (const ev of test.evaluators) {
      if (ev.score == null) continue;

      const category = EVALUATOR_CATEGORY_MAP[ev.name];
      if (!category) continue;

      if (ev.score < getThreshold(ev.name)) {
        const set = buckets.get(category) ?? new Set();
        set.add(test.name);
        buckets.set(category, set);
      }
    }
  }

  const clusters: FailureCluster[] = [];

  for (const [category, names] of buckets) {
    if (names.size === 0) continue;
    clusters.push({
      category,
      count: names.size,
      testNames: [...names],
      recommendedAction: RECOMMENDED_ACTIONS[category],
    });
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}
