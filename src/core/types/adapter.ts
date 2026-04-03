/**
 * Task adapter types: the universal adapter interface, examples, datasets,
 * and skill-layer configuration.
 */

import type { ToolCallRecord, TokenUsage, PhaseGate } from './common.js';
import type { ExpectedOutput } from './evaluator.js';

export interface Example<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TExpected = unknown,
  TMetadata extends Record<string, unknown> | null = Record<string, unknown> | null,
> {
  input: TInput;
  output?: TExpected;
  metadata?: TMetadata;
}

export interface TaskOutput {
  messages: Array<{ role: string; content: string }>;
  toolCalls: ToolCallRecord[];
  output: string;
  latencyMs: number;
  tokenUsage: TokenUsage | null;
  adapter: string;
  filesModified?: string[];
}

export type TaskAdapter<T extends Example = Example> = (example: T) => Promise<TaskOutput>;

export interface AdapterConfig {
  name: string;
  model?: string;
  timeout?: number;
  apiBaseUrl?: string;
  apiKey?: string;
  workingDir?: string;
  skillPath?: string;
  toolCatalog?: Record<string, string>;
  retry?: {
    maxRetries?: number;
    baseDelayMs?: number;
    retryPattern?: string;
  };
  [key: string]: unknown;
}

export interface EvalAdapterConfig {
  type: string;
  config?: Record<string, unknown>;
}

export interface EvalSetupConfig {
  notes?: string[];
  script?: string;
  feature_flags?: string[];
  seed_data?: boolean;
}

export interface EvalDefaultsConfig {
  maxTurns?: number;
  timeout?: number;
  repetitions?: number;
  judgeModel?: string;
  thresholds?: Record<string, number | Record<string, unknown>>;
  requiredPass?: string[];
}

export interface EvaluationDataset<T extends Example = Example> {
  name: string;
  description: string;
  examples: T[];
  adapters?: string[] | EvalAdapterConfig[];
  evaluators?: string[];
  evaluatorConditions?: Map<string, Record<string, unknown>>;
  defaults?: EvalDefaultsConfig;
  setup?: EvalSetupConfig;
  models?: string[];
  phaseGates?: Record<string, PhaseGate>;
  serverless?: {
    readiness?: string;
    limitations?: string[];
  };
  clusterSetup?: {
    seedScript?: string;
    esUrl?: string;
    kibanaUrl?: string;
  };
}

export interface SkillTestConfig {
  name: string;
  prompt: string;
  expected?: ExpectedOutput;
  evaluators?: string[];
  metadata?: Record<string, unknown>;
}

export interface SkillSuiteConfig {
  name: string;
  skillDir: string;
  adapters?: string[];
  evaluators?: string[];
  repetitions?: number;
}
