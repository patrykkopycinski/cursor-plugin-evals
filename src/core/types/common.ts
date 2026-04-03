/**
 * Zero-dependency primitive types used across the eval framework.
 */

export type Layer = 'unit' | 'static' | 'integration' | 'llm' | 'performance' | 'skill';

export type EvaluatorKind = 'CODE' | 'LLM';

export type Difficulty = 'simple' | 'moderate' | 'complex' | 'adversarial';

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

export interface ConversationMessage {
  role: string;
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
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

export interface Model {
  id: string;
  family?: string;
  provider?: string;
}

export interface ConfidenceInterval {
  mean: number;
  stddev: number;
  lowerBound: number;
  upperBound: number;
  sampleSize: number;
}

export interface PhaseGate {
  first_try_pass_rate?: number;
  e2e_completion_rate?: number;
  description: string;
}

// --- Assertion Types ---

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

export interface AssertionConfig {
  field: string;
  op: AssertionOp;
  value?: unknown;
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
