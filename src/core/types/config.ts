/**
 * Configuration types: eval config, suite config, test configs, and defaults.
 */

import type {
  Layer,
  Difficulty,
  AssertionConfig,
  PhaseGate,
} from './common.js';
import type { ExpectedOutput } from './evaluator.js';

// --- Per-layer test config types ---

export interface UnitTestConfig {
  name: string;
  difficulty?: Difficulty;
  requireEnv?: string[];
  check: 'registration' | 'schema' | 'conditional_registration' | 'response_format';
  expectedTools?: string[];
  tool?: string;
  args?: Record<string, unknown>;
  env?: Record<string, string>;
  minimalEnv?: Record<string, string>;
}

export interface IntegrationTestConfig {
  name: string;
  difficulty?: Difficulty;
  requireEnv?: string[];
  tool: string;
  args: Record<string, unknown>;
  assert?: AssertionConfig[];
  setup?: string;
  teardown?: string;
  workflow?: WorkflowStep[];
  expectError?: boolean;
}

export interface WorkflowStep {
  tool: string;
  args: Record<string, unknown>;
  output?: string;
  assert?: AssertionConfig[];
}

export interface ConversationTurn {
  prompt: string;
  system?: string;
  expected?: ExpectedOutput;
  evaluators?: string[];
}

export interface LlmTestConfig {
  name: string;
  difficulty?: Difficulty;
  requireEnv?: string[];
  type?: 'single' | 'conversation';
  prompt: string;
  expected: ExpectedOutput;
  evaluators: string[];
  maxTurns?: number;
  models?: string[];
  system?: string;
  turns?: ConversationTurn[];
  distractors?: {
    mode: 'random' | 'targeted' | 'none';
    count?: number;
  };
  /** Prompt variation styles to generate additional test runs (e.g., ['vague', 'casual']). */
  variations?: Array<'vague' | 'casual' | 'terse' | 'verbose' | 'noisy'>;
}

export interface PerformanceTestConfig {
  name: string;
  tool: string;
  args: Record<string, unknown>;
  warmup?: number;
  iterations?: number;
  concurrency?: number;
  thresholds?: { p50?: number; p95?: number; p99?: number };
  difficulty?: Difficulty;
  requireEnv?: string[];
}

export type StaticCheck =
  | 'manifest'
  | 'skill_frontmatter'
  | 'rule_frontmatter'
  | 'agent_frontmatter'
  | 'command_frontmatter'
  | 'hooks_schema'
  | 'mcp_config'
  | 'component_references'
  | 'cross_component_coherence'
  | 'naming_conventions'
  | 'skill_content_quality'
  | 'skill_content_structure'
  | 'skill_reference_files';

export interface StaticTestConfig {
  name: string;
  difficulty?: Difficulty;
  requireEnv?: string[];
  check: StaticCheck;
  components?: string[];
}

export type TestConfig =
  | UnitTestConfig
  | StaticTestConfig
  | IntegrationTestConfig
  | LlmTestConfig
  | PerformanceTestConfig;

// --- Suite & Eval config ---

export interface SuiteEvaluatorOverrides {
  add?: string[];
  remove?: string[];
  override?: string[];
}

export interface SuiteConfig {
  name: string;
  layer: Layer;
  requireEnv?: string[];
  setup?: string;
  teardown?: string;
  defaults?: DefaultsConfig;
  adapter?: string | string[];
  skillDir?: string;
  skillPath?: string;
  skipIsolation?: boolean;
  evaluators?: SuiteEvaluatorOverrides;
  concurrency?: number;
  testFilter?: {
    adapters?: string[];
    names?: Set<string>;
    pattern?: RegExp;
  };
  tests: TestConfig[];
  matrix?: Record<string, (string | number)[]>;
  matrixValues?: Record<string, string | number>;
}

export type { TransportConfig, TransportType } from '../../transports/types.js';

export interface PluginConfig {
  name: string;
  dir?: string;
  entry?: string;
  pluginRoot?: string;
  buildCommand?: string;
  env?: Record<string, string>;
  transport?: import('../../transports/types.js').TransportType;
  url?: string;
  headers?: Record<string, string>;
  auth?: {
    type: 'api-key' | 'bearer' | 'oauth2';
    key?: string;
    token?: string;
    header?: string;
    prefix?: string;
    tokenUrl?: string;
    clientId?: string;
    clientSecret?: string;
    scopes?: string[];
  };
}

export interface InfrastructureConfig {
  dockerCompose?: string;
  obsEsUrl?: string;
}

export interface TracingConfig {
  otelEndpoint?: string;
  langsmithProject?: string;
}

export interface DefaultsConfig {
  timeout?: number;
  judgeModel?: string;
  repetitions?: number;
  thresholds?: Record<string, number | Record<string, unknown>>;
}

export interface ScoringConfig {
  weights?: Record<string, number>;
}

export interface PluginEntry {
  name: string;
  module: string;
}

export interface PluginsConfig {
  evaluators?: PluginEntry[];
  reporters?: PluginEntry[];
  transports?: PluginEntry[];
}

export interface GuardrailRuleConfig {
  name: string;
  pattern: string;
  action: 'block' | 'warn' | 'log';
  message?: string;
}

export interface PostRunHookWebhook {
  type: 'webhook';
  url: string;
  template?: string;
  headers?: Record<string, string>;
}

export interface PostRunHookScript {
  type: 'script';
  command: string;
  passEnv?: string[];
}

export type PostRunHook = PostRunHookWebhook | PostRunHookScript;

export interface DerivedMetricConfig {
  name: string;
  formula: string;
  threshold?: number;
}

export interface CiThresholds {
  score?: { avg?: number; min?: number; max?: number; p50?: number; p95?: number; p99?: number };
  latency?: { avg?: number; p95?: number };
  cost?: { max?: number };
  evaluators?: Record<
    string,
    { avg?: number; min?: number; max?: number; p50?: number; p95?: number; p99?: number }
  >;
  requiredPass?: string[];
  firstTryPassRate?: number;
  phaseGate?: PhaseGate;
}

export interface EvalConfig {
  plugin: PluginConfig;
  infrastructure?: InfrastructureConfig;
  tracing?: TracingConfig;
  defaults?: DefaultsConfig;
  scoring?: ScoringConfig;
  plugins?: PluginsConfig;
  ci?: CiThresholds;
  guardrails?: GuardrailRuleConfig[];
  postRun?: PostRunHook[];
  derivedMetrics?: DerivedMetricConfig[];
  suites: SuiteConfig[];
}
