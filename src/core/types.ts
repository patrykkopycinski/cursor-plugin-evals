export type Layer = 'unit' | 'static' | 'integration' | 'llm' | 'performance' | 'skill';

export type EvaluatorKind = 'CODE' | 'LLM';

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: ToolResult;
  latencyMs: number;
}

export interface ToolResult {
  content: Array<{ type: string; text?: string; blob?: string }>;
  isError?: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
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

export interface PerformanceMetrics {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
  throughput: number;
  memoryDelta: number;
  samples: number;
}

export interface ConversationMessage {
  role: string;
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

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
  confidenceIntervals?: import('../scoring/confidence.js').AggregatedConfidence;
  ciResult?: CiResult;
  derivedMetrics?: DerivedMetricResult[];
  trialMetrics?: TrialMetrics;
  recommendations?: Array<{ type: string; priority: string; message: string }>;
}

export interface TrialMetrics {
  perTrialSuccessRate: number;
  passAtK: Record<number, number>;
  passHatK: Record<number, number>;
  kValues: number[];
}

export interface DerivedMetricConfig {
  name: string;
  formula: string;
  threshold?: number;
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

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  [key: string]: unknown;
}

export interface OpenAIFunctionDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: JsonSchema;
  };
}

export interface Evaluator {
  name: string;
  kind?: EvaluatorKind;
  evaluate(context: EvaluatorContext): Promise<EvaluatorResult>;
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

export type ClusterCheckType = 'es_query' | 'kibana_api' | 'script';

export interface ClusterStateAssertion {
  type?: ClusterCheckType;
  method: string;
  path: string;
  body?: unknown;
  script?: string;
  description?: string;
  assert: AssertionConfig[];
}

export interface AssertionConfig {
  field: string;
  op: AssertionOp;
  value?: unknown;
}

export const BASE_ASSERTION_OPS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'contains', 'not_contains', 'exists', 'not_exists',
  'length_gte', 'length_lte', 'type', 'matches',
  'one_of', 'starts_with', 'ends_with',
] as const;

export type BaseAssertionOp = (typeof BASE_ASSERTION_OPS)[number];

/**
 * Any base assertion op, or its `not_` negated variant (e.g. `not_eq`, `not_matches`).
 * `not_contains` and `not_exists` have explicit implementations; all other `not_` ops
 * are handled by running the base op and inverting the result.
 */
export type AssertionOp = BaseAssertionOp | `not_${BaseAssertionOp}`;

export type Difficulty = 'simple' | 'moderate' | 'complex' | 'adversarial';

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

export type TestConfig =
  | UnitTestConfig
  | StaticTestConfig
  | IntegrationTestConfig
  | LlmTestConfig
  | PerformanceTestConfig;

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
  | 'skill_reference_files';

export interface StaticTestConfig {
  name: string;
  difficulty?: Difficulty;
  requireEnv?: string[];
  check: StaticCheck;
  components?: string[];
}

export interface SkillComponent {
  name: string;
  description: string;
  path: string;
  body: string;
  license?: string;
}

export interface RuleComponent {
  description: string;
  alwaysApply?: boolean;
  globs?: string | string[];
  path: string;
  body: string;
}

export interface AgentComponent {
  name: string;
  description: string;
  model?: string;
  isBackground?: boolean;
  readonly?: boolean;
  path: string;
  body: string;
}

export interface CommandComponent {
  name?: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string | string[];
  disableModelInvocation?: boolean;
  path: string;
  body: string;
}

export interface HookHandler {
  command: string;
  matcher?: string;
  async?: boolean;
}

export interface HookComponent {
  event: string;
  handlers: HookHandler[];
}

export interface McpServerComponent {
  name: string;
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface PluginManifest {
  name: string;
  description?: string;
  version?: string;
  dir: string;
  skills: SkillComponent[];
  rules: RuleComponent[];
  agents: AgentComponent[];
  commands: CommandComponent[];
  hooks: HookComponent[];
  mcpServers: McpServerComponent[];
}

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
  testFilter?: {
    adapters?: string[];
  };
  tests: TestConfig[];
  matrix?: Record<string, (string | number)[]>;
  matrixValues?: Record<string, string | number>;
}

export type { TransportConfig, TransportType } from '../transports/types.js';

export interface PluginConfig {
  name: string;
  dir?: string;
  entry?: string;
  pluginRoot?: string;
  buildCommand?: string;
  env?: Record<string, string>;
  transport?: import('../transports/types.js').TransportType;
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

export interface ConfidenceInterval {
  mean: number;
  stddev: number;
  lowerBound: number;
  upperBound: number;
  sampleSize: number;
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

// --- Adapter & Skill Layer Types ---

export interface Model {
  id: string;
  family?: string;
  provider?: string;
}

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

export interface EvalSetupConfig {
  notes?: string[];
  script?: string;
  feature_flags?: string[];
  seed_data?: boolean;
}

export interface PhaseGate {
  first_try_pass_rate?: number;
  e2e_completion_rate?: number;
  description: string;
}

export interface EvalAdapterConfig {
  type: string;
  config?: Record<string, unknown>;
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

// --- CI Threshold Types ---

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
