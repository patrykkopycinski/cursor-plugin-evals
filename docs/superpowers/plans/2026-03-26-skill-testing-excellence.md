# Skill Testing Excellence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cursor-plugin-evals the best-in-class framework for skill testing with 10 new capabilities: routing accuracy, description quality, context budget, negative tests, composability, A/B variants, context isolation, readability, multi-turn skills, and tool dependency validation.

**Architecture:** Each feature is a self-contained module. Routing evaluator uses LLM to test if skill activates for matching/non-matching prompts. Description scorer analyzes clarity and uniqueness. Context budget estimates token footprint per skill. Negative test generation extends skill-eval init. Composability tests multi-skill scenarios. A/B variant compares two skill versions using existing Welch's t-test. Readability uses syllable counting for Flesch-Kincaid. Multi-turn extends skill layer to support conversation turns. Tool dependency validates expected tools exist in the plugin manifest.

**Tech Stack:** TypeScript, Vitest, callJudge (LLM), yaml, chalk

---

### Task 1: Skill Routing Evaluator (Positive + Negative Trigger Tests)

**Files:**
- Create: `src/evaluators/skill-routing.ts`
- Create: `src/evaluators/skill-routing.test.ts`

**Context:** Tests whether an LLM correctly activates a skill for on-topic prompts (positive) and correctly ignores it for off-topic prompts (negative). Returns precision/recall/F1 for routing accuracy. Uses LLM-as-judge to simulate "would you activate this skill?"

- [ ] **Step 1: Write the failing test**

```typescript
// src/evaluators/skill-routing.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 0.9, label: 'ACTIVATED',
    explanation: '{"activated": true, "confidence": 0.95, "reasoning": "Prompt matches skill purpose"}',
  }),
  handleJudgeError: vi.fn((name, err) => ({ evaluator: name, score: 0, pass: false, label: 'error', explanation: String(err) })),
}));

import { SkillRoutingEvaluator } from './skill-routing.js';

describe('SkillRoutingEvaluator', () => {
  it('scores 1.0 when skill should activate and LLM says yes', async () => {
    const evaluator = new SkillRoutingEvaluator();
    const result = await evaluator.evaluate({
      testName: 'positive-trigger',
      prompt: 'Write an ES|QL query to count logs',
      toolCalls: [],
      config: {
        'skill-routing': {
          skillDescription: 'Helps users write ES|QL queries',
          shouldActivate: true,
        },
      },
    });
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.pass).toBe(true);
  });

  it('scores 1.0 when skill should NOT activate and LLM says no', async () => {
    const { callJudge } = await import('./llm-judge.js');
    (callJudge as any).mockResolvedValueOnce({
      score: 0.1, label: 'NOT_ACTIVATED',
      explanation: '{"activated": false, "confidence": 0.9, "reasoning": "Prompt is unrelated"}',
    });

    const evaluator = new SkillRoutingEvaluator();
    const result = await evaluator.evaluate({
      testName: 'negative-trigger',
      prompt: 'What is the weather in Tokyo?',
      toolCalls: [],
      config: {
        'skill-routing': {
          skillDescription: 'Helps users write ES|QL queries',
          shouldActivate: false,
        },
      },
    });
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.pass).toBe(true);
  });

  it('scores 0 when routing is wrong', async () => {
    const { callJudge } = await import('./llm-judge.js');
    (callJudge as any).mockResolvedValueOnce({
      score: 0.9, label: 'ACTIVATED',
      explanation: '{"activated": true, "confidence": 0.9, "reasoning": "Wrongly activated"}',
    });

    const evaluator = new SkillRoutingEvaluator();
    const result = await evaluator.evaluate({
      testName: 'false-positive',
      prompt: 'What is the weather?',
      toolCalls: [],
      config: {
        'skill-routing': {
          skillDescription: 'Helps users write ES|QL queries',
          shouldActivate: false,
        },
      },
    });
    expect(result.score).toBeLessThan(0.5);
    expect(result.pass).toBe(false);
  });

  it('returns skipped when no config provided', async () => {
    const evaluator = new SkillRoutingEvaluator();
    const result = await evaluator.evaluate({ testName: 'no-config', prompt: 'test', toolCalls: [] });
    expect(result.skipped).toBe(true);
  });
});
```

- [ ] **Step 2: Implement skill-routing.ts**

```typescript
// src/evaluators/skill-routing.ts
import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge, handleJudgeError } from './llm-judge.js';

interface RoutingConfig {
  skillDescription: string;
  shouldActivate: boolean;
}

const SYSTEM_PROMPT = `You are testing skill routing accuracy. Given a skill description and a user prompt, determine if an LLM agent SHOULD activate this skill to handle the prompt.

Respond ONLY with valid JSON:
{
  "activated": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

Be strict: the skill should ONLY activate if the prompt clearly falls within the skill's stated purpose.`;

export class SkillRoutingEvaluator implements Evaluator {
  name = 'skill-routing';
  kind: 'LLM' as EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const config = context.config?.['skill-routing'] as RoutingConfig | undefined;
    if (!config?.skillDescription) {
      return { evaluator: this.name, score: 0, pass: true, skipped: true, label: 'no_config', explanation: 'No skill-routing config provided.' };
    }

    const userPrompt = `Skill description: "${config.skillDescription}"\n\nUser prompt: "${context.prompt ?? ''}"`;

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const json = result.explanation.match(/\{[\s\S]*\}/);
      const parsed = json ? JSON.parse(json[0]) as { activated: boolean; confidence: number; reasoning: string } : { activated: result.score > 0.5, confidence: result.score, reasoning: result.explanation };

      const correct = parsed.activated === config.shouldActivate;
      const score = correct ? parsed.confidence : 1 - parsed.confidence;
      const threshold = (context.config?.['skill-routing-threshold'] as number | undefined) ?? 0.7;

      return {
        evaluator: this.name, score, pass: score >= threshold,
        label: correct ? 'CORRECT_ROUTING' : config.shouldActivate ? 'FALSE_NEGATIVE' : 'FALSE_POSITIVE',
        explanation: `${correct ? 'Correct' : 'Incorrect'} routing (confidence: ${parsed.confidence.toFixed(2)}). ${parsed.reasoning}`,
        metadata: { shouldActivate: config.shouldActivate, activated: parsed.activated, confidence: parsed.confidence },
      };
    } catch (err) { return handleJudgeError(this.name, err); }
  }
}
```

- [ ] **Step 3: Run tests**
Run: `npx vitest run src/evaluators/skill-routing.test.ts`

---

### Task 2: Description Quality Scorer

**Files:**
- Create: `src/evaluators/skill-description.ts`
- Create: `src/evaluators/skill-description.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/evaluators/skill-description.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 0.85, label: 'GOOD',
    explanation: '{"clarity": 0.9, "specificity": 0.8, "actionability": 0.85, "uniqueness": 0.85, "issues": []}',
  }),
  handleJudgeError: vi.fn((name, err) => ({ evaluator: name, score: 0, pass: false, label: 'error', explanation: String(err) })),
}));

import { SkillDescriptionEvaluator } from './skill-description.js';

describe('SkillDescriptionEvaluator', () => {
  it('scores a clear description highly', async () => {
    const evaluator = new SkillDescriptionEvaluator();
    const result = await evaluator.evaluate({
      testName: 'desc-quality', prompt: '', toolCalls: [],
      config: { 'skill-description': { description: 'Generate ES|QL queries from natural language for Elasticsearch', otherDescriptions: ['Manage Kibana dashboards'] } },
    });
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.metadata?.clarity).toBeDefined();
  });

  it('skips when no description provided', async () => {
    const evaluator = new SkillDescriptionEvaluator();
    const result = await evaluator.evaluate({ testName: 'no-desc', prompt: '', toolCalls: [] });
    expect(result.skipped).toBe(true);
  });
});
```

- [ ] **Step 2: Implement skill-description.ts**

```typescript
// src/evaluators/skill-description.ts
import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge, handleJudgeError } from './llm-judge.js';

interface DescConfig { description: string; otherDescriptions?: string[]; }

const SYSTEM_PROMPT = `Score this skill description on 4 dimensions (0.0-1.0 each):
- clarity: Is it clear what the skill does?
- specificity: Is it specific enough that an LLM won't confuse it with other skills?
- actionability: Does it describe when to use it?
- uniqueness: How distinct is it from the other skill descriptions provided?

Respond ONLY with valid JSON:
{"clarity": 0.0-1.0, "specificity": 0.0-1.0, "actionability": 0.0-1.0, "uniqueness": 0.0-1.0, "issues": ["list of specific improvement suggestions"]}`;

export class SkillDescriptionEvaluator implements Evaluator {
  name = 'skill-description';
  kind: 'LLM' as EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const config = context.config?.['skill-description'] as DescConfig | undefined;
    if (!config?.description) {
      return { evaluator: this.name, score: 0, pass: true, skipped: true, label: 'no_config', explanation: 'No description provided.' };
    }

    const others = config.otherDescriptions?.length ? `\n\nOther skill descriptions in this plugin:\n${config.otherDescriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}` : '';
    const userPrompt = `Skill description: "${config.description}"${others}`;

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const json = result.explanation.match(/\{[\s\S]*\}/);
      const parsed = json ? JSON.parse(json[0]) as { clarity: number; specificity: number; actionability: number; uniqueness: number; issues: string[] } : { clarity: result.score, specificity: result.score, actionability: result.score, uniqueness: result.score, issues: [] };

      const score = (parsed.clarity + parsed.specificity + parsed.actionability + parsed.uniqueness) / 4;
      const threshold = (context.config?.['skill-description-threshold'] as number | undefined) ?? 0.7;

      return {
        evaluator: this.name, score, pass: score >= threshold,
        label: score >= 0.8 ? 'EXCELLENT' : score >= 0.6 ? 'GOOD' : 'NEEDS_WORK',
        explanation: `Clarity: ${parsed.clarity.toFixed(2)}, Specificity: ${parsed.specificity.toFixed(2)}, Actionability: ${parsed.actionability.toFixed(2)}, Uniqueness: ${parsed.uniqueness.toFixed(2)}. ${parsed.issues.length > 0 ? 'Issues: ' + parsed.issues.join('; ') : 'No issues.'}`,
        metadata: { clarity: parsed.clarity, specificity: parsed.specificity, actionability: parsed.actionability, uniqueness: parsed.uniqueness, issues: parsed.issues },
      };
    } catch (err) { return handleJudgeError(this.name, err); }
  }
}
```

- [ ] **Step 3: Run tests**
Run: `npx vitest run src/evaluators/skill-description.test.ts`

---

### Task 3: Context Budget Analyzer

**Files:**
- Create: `src/analyzers/context-budget.ts`
- Create: `src/analyzers/context-budget.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/analyzers/context-budget.test.ts
import { describe, it, expect } from 'vitest';
import { analyzeContextBudget, type ContextBudgetReport } from './context-budget.js';
import type { SkillComponent } from '../core/types.js';

function makeSkill(name: string, bodyLength: number): SkillComponent {
  return { name, description: `Skill ${name}`, path: `/skills/${name}`, body: 'x'.repeat(bodyLength) };
}

describe('analyzeContextBudget', () => {
  it('estimates tokens from skill body', () => {
    const report = analyzeContextBudget([makeSkill('small', 400)]);
    expect(report.skills[0].estimatedTokens).toBeCloseTo(100, -1); // ~4 chars per token
    expect(report.skills[0].bloated).toBe(false);
  });

  it('flags bloated skills over threshold', () => {
    const report = analyzeContextBudget([makeSkill('huge', 8000)]); // ~2000 tokens
    expect(report.skills[0].bloated).toBe(true);
  });

  it('computes total budget and remaining', () => {
    const report = analyzeContextBudget([makeSkill('a', 2000), makeSkill('b', 2000)], { contextWindow: 128000 });
    expect(report.totalEstimatedTokens).toBeGreaterThan(0);
    expect(report.remainingTokens).toBeLessThan(128000);
    expect(report.utilizationPercent).toBeGreaterThan(0);
  });

  it('warns when total exceeds budget threshold', () => {
    const skills = Array.from({ length: 20 }, (_, i) => makeSkill(`s${i}`, 4000));
    const report = analyzeContextBudget(skills, { contextWindow: 8000, warningThreshold: 0.5 });
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('returns empty report for no skills', () => {
    const report = analyzeContextBudget([]);
    expect(report.skills).toHaveLength(0);
    expect(report.totalEstimatedTokens).toBe(0);
  });
});
```

- [ ] **Step 2: Implement context-budget.ts**

```typescript
// src/analyzers/context-budget.ts
import type { SkillComponent } from '../core/types.js';

export interface SkillBudgetEntry {
  name: string;
  charCount: number;
  estimatedTokens: number;
  lineCount: number;
  bloated: boolean;
}

export interface ContextBudgetReport {
  skills: SkillBudgetEntry[];
  totalEstimatedTokens: number;
  contextWindow: number;
  remainingTokens: number;
  utilizationPercent: number;
  warnings: string[];
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const BLOAT_THRESHOLD_TOKENS = 1500; // ~500 lines recommended max
const DEFAULT_WARNING_THRESHOLD = 0.25;

export function analyzeContextBudget(
  skills: SkillComponent[],
  options?: { contextWindow?: number; warningThreshold?: number; bloatThreshold?: number },
): ContextBudgetReport {
  const contextWindow = options?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const warningThreshold = options?.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
  const bloatThreshold = options?.bloatThreshold ?? BLOAT_THRESHOLD_TOKENS;

  const entries: SkillBudgetEntry[] = skills.map(skill => {
    const body = skill.body ?? '';
    const charCount = body.length;
    const estimatedTokens = Math.ceil(charCount / CHARS_PER_TOKEN);
    const lineCount = body.split('\n').length;
    return { name: skill.name, charCount, estimatedTokens, lineCount, bloated: estimatedTokens > bloatThreshold };
  });

  const totalEstimatedTokens = entries.reduce((s, e) => s + e.estimatedTokens, 0);
  const remainingTokens = contextWindow - totalEstimatedTokens;
  const utilizationPercent = contextWindow > 0 ? (totalEstimatedTokens / contextWindow) * 100 : 0;

  const warnings: string[] = [];
  if (utilizationPercent > warningThreshold * 100) {
    warnings.push(`Skills consume ${utilizationPercent.toFixed(1)}% of context window (${totalEstimatedTokens} / ${contextWindow} tokens)`);
  }
  for (const e of entries) {
    if (e.bloated) warnings.push(`Skill "${e.name}" is bloated: ~${e.estimatedTokens} tokens (${e.lineCount} lines). Recommended: <${bloatThreshold} tokens.`);
  }

  return { skills: entries, totalEstimatedTokens, contextWindow, remainingTokens, utilizationPercent, warnings };
}
```

- [ ] **Step 3: Run tests**
Run: `npx vitest run src/analyzers/context-budget.test.ts`

---

### Task 4: Negative Test Generation in skill-eval init

**Files:**
- Modify: `src/skill-init/generator.ts`
- Create: `src/skill-init/negative-gen.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/skill-init/negative-gen.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../evaluators/llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 1, label: 'OK',
    explanation: JSON.stringify({
      tests: [
        { name: 'neg-weather', prompt: 'What is the weather today?', expected: { response_not_contains: ['FROM', 'STATS'] }, difficulty: 'simple', category: 'negative' },
        { name: 'neg-recipe', prompt: 'Give me a pasta recipe', expected: { response_not_contains: ['ES|QL', 'query'] }, difficulty: 'simple', category: 'negative' },
        { name: 'neg-math', prompt: 'What is 2+2?', expected: { response_not_contains: ['FROM', 'WHERE'] }, difficulty: 'simple', category: 'negative' },
      ],
    }),
  }),
}));

import { generateNegativeTests } from './generator.js';
import type { SkillProfile } from './analyzer.js';

const PROFILE: SkillProfile = {
  name: 'esql', purpose: 'Generate ES|QL queries', capabilities: ['ES|QL'],
  expectedTools: [], keyDomainTerms: ['FROM', 'WHERE'], complexity: 'moderate', hasCodeOutput: true, hasFileOutput: false,
};

describe('generateNegativeTests', () => {
  it('generates off-topic tests for a skill', async () => {
    const tests = await generateNegativeTests(PROFILE);
    expect(tests.length).toBeGreaterThanOrEqual(2);
    expect(tests.every(t => t.category === 'negative')).toBe(true);
    expect(tests.every(t => t.expected.response_not_contains && t.expected.response_not_contains.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Add generateNegativeTests to generator.ts**

Append to `src/skill-init/generator.ts`:

```typescript
const NEGATIVE_SYSTEM_PROMPT = `Generate 3 prompts that are clearly OFF-TOPIC for this skill — prompts where this skill should NOT activate. Include response_not_contains with domain keywords that should NOT appear in the response.

Respond ONLY with JSON:
{"tests": [{"name": "neg-kebab-name", "prompt": "off-topic prompt", "expected": {"response_not_contains": ["domain-keyword"]}, "difficulty": "simple", "category": "negative"}]}`;

export async function generateNegativeTests(profile: SkillProfile, model?: string): Promise<GeneratedTest[]> {
  const response = await callJudge({
    systemPrompt: NEGATIVE_SYSTEM_PROMPT,
    userPrompt: JSON.stringify({ name: profile.name, purpose: profile.purpose, keyDomainTerms: profile.keyDomainTerms }),
    model,
  });
  const jsonMatch = response.explanation.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]) as { tests: GeneratedTest[] };
  return Array.isArray(parsed.tests) ? parsed.tests : [];
}
```

- [ ] **Step 3: Run tests**
Run: `npx vitest run src/skill-init/negative-gen.test.ts`

---

### Task 5: Skill Composability Tests

**Files:**
- Create: `src/evaluators/skill-composability.ts`
- Create: `src/evaluators/skill-composability.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/evaluators/skill-composability.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./llm-judge.js', () => ({
  callJudge: vi.fn().mockResolvedValue({
    score: 0.85, label: 'COMPATIBLE',
    explanation: '{"compatible": true, "interference": false, "chainable": true, "issues": []}',
  }),
  handleJudgeError: vi.fn((name, err) => ({ evaluator: name, score: 0, pass: false, label: 'error', explanation: String(err) })),
}));

import { SkillComposabilityEvaluator } from './skill-composability.js';

describe('SkillComposabilityEvaluator', () => {
  it('scores skills that work well together', async () => {
    const evaluator = new SkillComposabilityEvaluator();
    const result = await evaluator.evaluate({
      testName: 'compose-test', toolCalls: [],
      prompt: 'First discover data, then write an ES|QL query',
      config: {
        'skill-composability': {
          skills: [
            { name: 'data-discovery', description: 'Discover available data sources' },
            { name: 'esql-writer', description: 'Write ES|QL queries' },
          ],
          scenario: 'Use data discovery output as context for ES|QL query generation',
        },
      },
    });
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.metadata?.compatible).toBe(true);
  });

  it('skips when no config', async () => {
    const evaluator = new SkillComposabilityEvaluator();
    const result = await evaluator.evaluate({ testName: 'no-config', prompt: '', toolCalls: [] });
    expect(result.skipped).toBe(true);
  });
});
```

- [ ] **Step 2: Implement skill-composability.ts**

```typescript
// src/evaluators/skill-composability.ts
import type { Evaluator, EvaluatorContext, EvaluatorResult, EvaluatorKind } from '../core/types.js';
import { callJudge, handleJudgeError } from './llm-judge.js';

interface SkillDef { name: string; description: string; }
interface ComposabilityConfig { skills: SkillDef[]; scenario: string; }

const SYSTEM_PROMPT = `Analyze whether these skills can work together effectively in the described scenario.

Evaluate:
- compatible: Can they coexist without conflicts?
- interference: Does one skill's context corrupt the other's?
- chainable: Can output from one feed into the other?

Respond ONLY with JSON:
{"compatible": true/false, "interference": true/false, "chainable": true/false, "issues": ["list of potential problems"], "score": 0.0-1.0}`;

export class SkillComposabilityEvaluator implements Evaluator {
  name = 'skill-composability';
  kind: 'LLM' as EvaluatorKind = 'LLM';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const config = context.config?.['skill-composability'] as ComposabilityConfig | undefined;
    if (!config?.skills?.length) {
      return { evaluator: this.name, score: 0, pass: true, skipped: true, label: 'no_config', explanation: 'No composability config.' };
    }

    const userPrompt = `Skills:\n${config.skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}\n\nScenario: ${config.scenario}`;

    try {
      const result = await callJudge({ systemPrompt: SYSTEM_PROMPT, userPrompt });
      const json = result.explanation.match(/\{[\s\S]*\}/);
      const parsed = json ? JSON.parse(json[0]) as { compatible: boolean; interference: boolean; chainable: boolean; issues: string[]; score: number } : { compatible: true, interference: false, chainable: true, issues: [], score: result.score };

      const score = parsed.score ?? (parsed.compatible && !parsed.interference ? 0.9 : 0.3);
      const threshold = (context.config?.['skill-composability-threshold'] as number | undefined) ?? 0.7;

      return {
        evaluator: this.name, score, pass: score >= threshold,
        label: parsed.compatible ? 'COMPATIBLE' : 'INCOMPATIBLE',
        explanation: `Compatible: ${parsed.compatible}, Interference: ${parsed.interference}, Chainable: ${parsed.chainable}. ${parsed.issues.length > 0 ? 'Issues: ' + parsed.issues.join('; ') : ''}`,
        metadata: { compatible: parsed.compatible, interference: parsed.interference, chainable: parsed.chainable, issues: parsed.issues },
      };
    } catch (err) { return handleJudgeError(this.name, err); }
  }
}
```

- [ ] **Step 3: Run tests**
Run: `npx vitest run src/evaluators/skill-composability.test.ts`

---

### Task 6: Skill Variant A/B Testing

**Files:**
- Create: `src/skill-init/variant-compare.ts`
- Create: `src/skill-init/variant-compare.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/skill-init/variant-compare.test.ts
import { describe, it, expect } from 'vitest';
import { compareSkillVariants, type VariantResult } from './variant-compare.js';
import type { RunResult } from '../core/types.js';

function makeRun(scores: number[]): RunResult {
  return {
    runId: 'test', timestamp: '', config: '',
    suites: [{ name: 's', layer: 'skill', tests: scores.map((s, i) => ({ name: `t${i}`, suite: 's', layer: 'skill' as const, pass: s >= 0.5, toolCalls: [], evaluatorResults: [{ evaluator: 'correctness', score: s, pass: s >= 0.5 }], latencyMs: 100 })), passRate: scores.filter(s => s >= 0.5).length / scores.length, duration: 100, evaluatorSummary: {} }],
    overall: { total: scores.length, passed: scores.filter(s => s >= 0.5).length, failed: scores.filter(s => s < 0.5).length, skipped: 0, passRate: scores.filter(s => s >= 0.5).length / scores.length, duration: 100 },
  };
}

describe('compareSkillVariants', () => {
  it('detects improvement in variant B', () => {
    const result = compareSkillVariants(makeRun([0.5, 0.55, 0.52, 0.48, 0.51]), makeRun([0.9, 0.88, 0.92, 0.87, 0.91]), 'v1', 'v2');
    expect(result.winner).toBe('v2');
    expect(result.delta).toBeGreaterThan(0);
    expect(result.significant).toBe(true);
  });

  it('reports no significant difference for similar scores', () => {
    const result = compareSkillVariants(makeRun([0.8, 0.79, 0.81]), makeRun([0.8, 0.82, 0.78]), 'v1', 'v2');
    expect(result.significant).toBe(false);
  });

  it('includes summary text', () => {
    const result = compareSkillVariants(makeRun([0.5, 0.5, 0.5]), makeRun([0.9, 0.9, 0.9]), 'old', 'new');
    expect(result.summary).toContain('new');
  });
});
```

- [ ] **Step 2: Implement variant-compare.ts**

```typescript
// src/skill-init/variant-compare.ts
import { welchTTest } from '../regression/detector.js';
import type { RunResult } from '../core/types.js';

export interface VariantResult {
  variantA: string;
  variantB: string;
  meanA: number;
  meanB: number;
  delta: number;
  pValue: number;
  significant: boolean;
  winner: string | null;
  summary: string;
}

function extractScores(run: RunResult): number[] {
  return run.suites.flatMap(s => s.tests.map(t =>
    t.evaluatorResults.length > 0 ? t.evaluatorResults.reduce((sum, e) => sum + e.score, 0) / t.evaluatorResults.length : (t.pass ? 1 : 0),
  ));
}

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function compareSkillVariants(runA: RunResult, runB: RunResult, nameA: string, nameB: string): VariantResult {
  const scoresA = extractScores(runA);
  const scoresB = extractScores(runB);
  const meanA = mean(scoresA);
  const meanB = mean(scoresB);
  const delta = meanB - meanA;

  let pValue = 1;
  if (scoresA.length >= 2 && scoresB.length >= 2) {
    ({ pValue } = welchTTest(scoresA, scoresB));
  }

  const significant = pValue < 0.05;
  const winner = significant ? (delta > 0 ? nameB : nameA) : null;
  const dir = delta > 0 ? 'improved' : delta < 0 ? 'degraded' : 'unchanged';
  const sig = significant ? 'statistically significant' : 'not statistically significant';

  return {
    variantA: nameA, variantB: nameB, meanA, meanB, delta, pValue, significant, winner,
    summary: `${nameB} ${dir} by ${(Math.abs(delta) * 100).toFixed(1)}pp vs ${nameA} (p=${pValue.toFixed(4)}, ${sig}). ${winner ? `Winner: ${winner}` : 'No clear winner.'}`,
  };
}
```

- [ ] **Step 3: Run tests**
Run: `npx vitest run src/skill-init/variant-compare.test.ts`

---

### Task 7: Skill Readability Scoring

**Files:**
- Create: `src/analyzers/readability.ts`
- Create: `src/analyzers/readability.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/analyzers/readability.test.ts
import { describe, it, expect } from 'vitest';
import { computeReadability, type ReadabilityScore } from './readability.js';

describe('computeReadability', () => {
  it('scores simple text as highly readable', () => {
    const result = computeReadability('Use this skill to write queries. It helps you find data. Simple and fast.');
    expect(result.fleschKincaid).toBeLessThan(8);
    expect(result.grade).toBe('A');
  });

  it('scores complex text as less readable', () => {
    const result = computeReadability('The implementation necessitates comprehensive understanding of the architectural paradigm underlying the distributed computational infrastructure.');
    expect(result.fleschKincaid).toBeGreaterThan(12);
  });

  it('computes sentence and word counts', () => {
    const result = computeReadability('First sentence. Second sentence. Third sentence.');
    expect(result.sentences).toBe(3);
    expect(result.words).toBe(6);
  });

  it('handles empty text', () => {
    const result = computeReadability('');
    expect(result.words).toBe(0);
    expect(result.grade).toBe('F');
  });

  it('includes section structure analysis', () => {
    const md = '## Overview\nIntro text.\n## Usage\nHow to use.\n## Examples\nCode here.';
    const result = computeReadability(md);
    expect(result.sectionCount).toBe(3);
    expect(result.hasExamples).toBe(true);
  });
});
```

- [ ] **Step 2: Implement readability.ts**

```typescript
// src/analyzers/readability.ts

export interface ReadabilityScore {
  fleschKincaid: number;
  grade: string;
  words: number;
  sentences: number;
  syllables: number;
  avgWordsPerSentence: number;
  avgSyllablesPerWord: number;
  sectionCount: number;
  hasExamples: boolean;
  hasPrerequisites: boolean;
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  let count = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g)?.length ?? 1;
  return Math.max(1, count);
}

function gradeFromFK(fk: number): string {
  if (fk <= 6) return 'A';
  if (fk <= 8) return 'B';
  if (fk <= 10) return 'C';
  if (fk <= 12) return 'D';
  return 'F';
}

export function computeReadability(text: string): ReadabilityScore {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sectionCount = (text.match(/^#{1,4}\s+/gm) ?? []).length;
  const hasExamples = /example|```/i.test(text);
  const hasPrerequisites = /prerequisite|require|before you|setup/i.test(text);

  if (words.length === 0) {
    return { fleschKincaid: 99, grade: 'F', words: 0, sentences: 0, syllables: 0, avgWordsPerSentence: 0, avgSyllablesPerWord: 0, sectionCount, hasExamples, hasPrerequisites };
  }

  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : words.length;
  const avgSyllablesPerWord = syllables / words.length;

  const fleschKincaid = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;
  const fk = Math.max(0, fleschKincaid);

  return { fleschKincaid: fk, grade: gradeFromFK(fk), words: words.length, sentences: sentences.length, syllables, avgWordsPerSentence, avgSyllablesPerWord, sectionCount, hasExamples, hasPrerequisites };
}
```

- [ ] **Step 3: Run tests**
Run: `npx vitest run src/analyzers/readability.test.ts`

---

### Task 8: Multi-Turn Skill Conversations

**Files:**
- Create: `src/layers/skill/multi-turn.ts`
- Create: `src/layers/skill/multi-turn.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/layers/skill/multi-turn.test.ts
import { describe, it, expect } from 'vitest';
import { buildMultiTurnPrompt, type SkillTurn } from './multi-turn.js';

describe('buildMultiTurnPrompt', () => {
  it('builds a single-turn prompt', () => {
    const turns: SkillTurn[] = [{ role: 'user', content: 'Hello' }];
    const result = buildMultiTurnPrompt(turns);
    expect(result).toBe('Hello');
  });

  it('builds a multi-turn prompt with conversation history', () => {
    const turns: SkillTurn[] = [
      { role: 'user', content: 'What data sources are available?' },
      { role: 'assistant', content: 'Found 5 indices: logs-*, metrics-*, ...' },
      { role: 'user', content: 'Now write an ES|QL query for the logs index' },
    ];
    const result = buildMultiTurnPrompt(turns);
    expect(result).toContain('What data sources');
    expect(result).toContain('Found 5 indices');
    expect(result).toContain('Now write an ES|QL');
  });

  it('preserves turn order', () => {
    const turns: SkillTurn[] = [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Second' },
      { role: 'user', content: 'Third' },
    ];
    const result = buildMultiTurnPrompt(turns);
    const firstIdx = result.indexOf('First');
    const secondIdx = result.indexOf('Second');
    const thirdIdx = result.indexOf('Third');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('handles empty turns', () => {
    expect(buildMultiTurnPrompt([])).toBe('');
  });
});
```

- [ ] **Step 2: Implement multi-turn.ts**

```typescript
// src/layers/skill/multi-turn.ts

export interface SkillTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function buildMultiTurnPrompt(turns: SkillTurn[]): string {
  if (turns.length === 0) return '';
  if (turns.length === 1) return turns[0].content;

  return turns.map(t => {
    const prefix = t.role === 'user' ? 'User' : t.role === 'assistant' ? 'Assistant' : 'System';
    return `${prefix}: ${t.content}`;
  }).join('\n\n');
}

export function extractLastUserPrompt(turns: SkillTurn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === 'user') return turns[i].content;
  }
  return '';
}

export function turnCountByRole(turns: SkillTurn[]): Record<string, number> {
  const counts: Record<string, number> = { user: 0, assistant: 0, system: 0 };
  for (const t of turns) counts[t.role] = (counts[t.role] ?? 0) + 1;
  return counts;
}
```

- [ ] **Step 3: Run tests**
Run: `npx vitest run src/layers/skill/multi-turn.test.ts`

---

### Task 9: Tool Dependency Validation

**Files:**
- Create: `src/analyzers/tool-deps.ts`
- Create: `src/analyzers/tool-deps.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/analyzers/tool-deps.test.ts
import { describe, it, expect } from 'vitest';
import { validateToolDependencies, type ToolDepResult } from './tool-deps.js';

describe('validateToolDependencies', () => {
  it('passes when all expected tools exist', () => {
    const result = validateToolDependencies(['search', 'query'], ['search', 'query', 'index']);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('fails when tools are missing', () => {
    const result = validateToolDependencies(['search', 'delete_all'], ['search', 'query']);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('delete_all');
  });

  it('passes with empty expected tools', () => {
    const result = validateToolDependencies([], ['search']);
    expect(result.valid).toBe(true);
  });

  it('reports all missing tools', () => {
    const result = validateToolDependencies(['a', 'b', 'c'], ['d', 'e']);
    expect(result.missing).toEqual(['a', 'b', 'c']);
  });

  it('includes available tools in result', () => {
    const result = validateToolDependencies(['search'], ['search', 'query']);
    expect(result.available).toContain('query');
  });
});
```

- [ ] **Step 2: Implement tool-deps.ts**

```typescript
// src/analyzers/tool-deps.ts

export interface ToolDepResult {
  valid: boolean;
  missing: string[];
  available: string[];
  expected: string[];
}

export function validateToolDependencies(expectedTools: string[], availableTools: string[]): ToolDepResult {
  const available = new Set(availableTools);
  const missing = expectedTools.filter(t => !available.has(t));

  return {
    valid: missing.length === 0,
    missing,
    available: availableTools,
    expected: expectedTools,
  };
}
```

- [ ] **Step 3: Run tests**
Run: `npx vitest run src/analyzers/tool-deps.test.ts`

---

### Task 10: Register Evaluators, Export, Validate, Docs, Commit

- [ ] **Step 1: Register new evaluators in index.ts**

Add to `EVALUATOR_NAMES`: `'skill-routing'`, `'skill-description'`, `'skill-composability'`
Add imports and map entries for `SkillRoutingEvaluator`, `SkillDescriptionEvaluator`, `SkillComposabilityEvaluator`.

- [ ] **Step 2: Add exports to src/index.ts**

```typescript
// Skill Testing Excellence
export { SkillRoutingEvaluator } from './evaluators/skill-routing.js';
export { SkillDescriptionEvaluator } from './evaluators/skill-description.js';
export { SkillComposabilityEvaluator } from './evaluators/skill-composability.js';
export { analyzeContextBudget } from './analyzers/context-budget.js';
export type { ContextBudgetReport, SkillBudgetEntry } from './analyzers/context-budget.js';
export { computeReadability } from './analyzers/readability.js';
export type { ReadabilityScore } from './analyzers/readability.js';
export { validateToolDependencies } from './analyzers/tool-deps.js';
export type { ToolDepResult } from './analyzers/tool-deps.js';
export { compareSkillVariants } from './skill-init/variant-compare.js';
export type { VariantResult } from './skill-init/variant-compare.js';
export { generateNegativeTests } from './skill-init/generator.js';
export { buildMultiTurnPrompt } from './layers/skill/multi-turn.js';
export type { SkillTurn } from './layers/skill/multi-turn.js';
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Update README, docs sidebar, landing page**

Add evaluator count update (32 → 35: +skill-routing, +skill-description, +skill-composability).
Add new feature bullets to README. Add feature cards to landing page.

- [ ] **Step 6: Commit and push**

```bash
git add src/evaluators/skill-routing.ts src/evaluators/skill-routing.test.ts \
  src/evaluators/skill-description.ts src/evaluators/skill-description.test.ts \
  src/evaluators/skill-composability.ts src/evaluators/skill-composability.test.ts \
  src/analyzers/context-budget.ts src/analyzers/context-budget.test.ts \
  src/analyzers/readability.ts src/analyzers/readability.test.ts \
  src/analyzers/tool-deps.ts src/analyzers/tool-deps.test.ts \
  src/skill-init/generator.ts src/skill-init/negative-gen.test.ts \
  src/skill-init/variant-compare.ts src/skill-init/variant-compare.test.ts \
  src/layers/skill/multi-turn.ts src/layers/skill/multi-turn.test.ts \
  src/evaluators/index.ts src/index.ts \
  README.md docs/ site/
git commit -m "feat: skill testing excellence — 10 features for best-in-class skill evaluation"
git push origin main
```
