/**
 * Evaluator-related types: evaluation contexts, results, and expected outputs.
 */

import type {
  EvaluatorKind,
  ToolCallRecord,
  TokenUsage,
  ClusterStateAssertion,
} from './common.js';

export interface ExpectedOutput {
  tools?: string[];
  toolArgs?: Record<string, Record<string, unknown>>;
  toolSequence?: string[];
  goldenPath?: string[];
  responseContains?: string[];
  responseNotContains?: string[];
  clusterState?: ClusterStateAssertion[];
  esqlGolden?: string;
}

export interface EvaluatorResult {
  evaluator: string;
  score: number;
  pass: boolean;
  skipped?: boolean;
  label?: string;
  explanation?: string;
  metadata?: Record<string, unknown>;
}

export interface AdapterCapabilities {
  hasToolCalls: boolean;
  hasFileAccess: boolean;
  hasWorkspaceIsolation: boolean;
  reportsInputTokens: boolean;
}

export interface EvaluatorContext {
  testName: string;
  prompt?: string;
  toolCalls: ToolCallRecord[];
  finalOutput?: string;
  expected?: ExpectedOutput;
  config?: Record<string, unknown>;
  tokenUsage?: TokenUsage;
  latencyMs?: number;
  adapterName?: string;
  adapterCapabilities?: AdapterCapabilities;
}

export interface Evaluator {
  name: string;
  kind?: EvaluatorKind;
  evaluate(context: EvaluatorContext): Promise<EvaluatorResult>;
}
