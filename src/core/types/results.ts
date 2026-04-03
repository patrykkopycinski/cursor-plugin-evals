/**
 * Result types: test results, suite results, run results, CI verdicts,
 * model comparison, and collision detection.
 */

import type {
  Layer,
  ToolCallRecord,
  TokenUsage,
  PerformanceMetrics,
  ConversationMessage,
  Model,
  ConfidenceInterval,
} from './common.js';
import type { EvaluatorResult } from './evaluator.js';

// Re-export ConfidenceInterval so consumers that import from results get it
export type { ConfidenceInterval };

export interface TestResult {
  name: string;
  suite: string;
  layer: Layer;
  pass: boolean;
  skipped?: boolean;
  toolCalls: ToolCallRecord[];
  evaluatorResults: EvaluatorResult[];
  tokenUsage?: TokenUsage;
  latencyMs: number;
  error?: string;
  model?: string;
  repetition?: number;
  performanceMetrics?: PerformanceMetrics;
  costUsd?: number;
  adapter?: string;
  metadata?: Record<string, unknown>;
  conversation?: ConversationMessage[];
}

export interface SuiteResult {
  name: string;
  layer: Layer;
  tests: TestResult[];
  passRate: number;
  duration: number;
  evaluatorSummary: Record<
    string,
    { mean: number; min: number; max: number; pass: number; total: number }
  >;
}

export interface TrialMetrics {
  perTrialSuccessRate: number;
  passAtK: Record<number, number>;
  passHatK: Record<number, number>;
  kValues: number[];
}

export interface DerivedMetricResult {
  name: string;
  value: number;
  threshold?: number;
  pass: boolean;
  error?: string;
}

export interface QualityScoreResult {
  dimensions: Record<string, number>;
  composite: number;
  grade: string;
  weights: Record<string, number>;
}

export interface RunResult {
  runId: string;
  timestamp: string;
  config: string;
  suites: SuiteResult[];
  overall: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
    duration: number;
  };
  qualityScore?: QualityScoreResult;
  confidenceIntervals?: import('../../scoring/confidence.js').AggregatedConfidence;
  ciResult?: CiResult;
  derivedMetrics?: DerivedMetricResult[];
  trialMetrics?: TrialMetrics;
  recommendations?: Array<{
    type: string;
    priority: string;
    message: string;
    estimatedImpact?: string;
    skillSuggestion?: {
      section: string;
      action: string;
      content: string;
      rationale: string;
    };
  }>;
}

// --- CI Result Types ---

export interface CiViolation {
  metric: string;
  evaluator?: string;
  actual: number;
  threshold: number;
  testCase?: string;
}

export interface CiResult {
  passed: boolean;
  violations: CiViolation[];
  summary: string;
}

// --- Comparison Types ---

export interface ModelAggregate {
  model: Model;
  avgScore: number;
  passCount: number;
  failCount: number;
  totalLatencyMs: number;
  totalCostUsd: number | null;
}

export interface ModelComparisonMatrix {
  testNames: string[];
  evaluatorNames: string[];
  cells: Record<string, Record<string, Record<string, number | null>>>;
  aggregates: Record<string, ModelAggregate>;
}

export interface ComparisonResult {
  comparisonId: string;
  models: Model[];
  matrix: ModelComparisonMatrix;
}

// --- Collision Detection Types ---

export interface SkillInfo {
  name: string;
  dirName: string;
  description: string;
  tools: string[];
  body: string;
}

export interface CollisionPair {
  skillA: string;
  skillB: string;
  descriptionSimilarity: number;
  toolOverlap: number;
  sharedTools: string[];
  contentSimilarity: number;
  verdict: 'ok' | 'warn' | 'error';
  recommendation: string;
}

export interface CollisionReport {
  skills: SkillInfo[];
  pairs: CollisionPair[];
  errors: CollisionPair[];
  warnings: CollisionPair[];
  clean: CollisionPair[];
}
