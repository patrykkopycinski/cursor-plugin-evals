import type { EvaluatorContext, EvaluatorResult } from '../core/types.js';

/** Protocol version — increment on breaking changes */
export const PROTOCOL_VERSION = '1.0';

/** Input sent to custom evaluator via stdin */
export interface CustomEvalInput {
  protocol_version: string;
  evaluator_name: string;
  test_name: string;
  prompt: string | null;
  final_output: string | null;
  tool_calls: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: { content: string; is_error: boolean };
    latency_ms: number;
  }>;
  expected: {
    tools?: string[];
    tool_args?: Record<string, Record<string, unknown>>;
    tool_sequence?: string[];
    response_contains?: string[];
    response_pattern?: string;
    golden_path?: string[];
    [key: string]: unknown;
  } | null;
  token_usage: { input: number; output: number; cached?: number } | null;
  latency_ms: number | null;
  adapter: string | null;
  config: Record<string, unknown>;
  messages: Array<{ role: string; content: string }>;
}

/** Output expected from custom evaluator via stdout */
export interface CustomEvalOutput {
  protocol_version: string;
  score: number;
  pass: boolean;
  label?: string;
  explanation?: string;
  metadata?: Record<string, unknown>;
  skipped?: boolean;
  skip_reason?: string;
}

/** Evaluator manifest for discovery */
export interface EvaluatorManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  language: string;
  entry: string;
  protocol_version: string;
  config_schema?: Record<string, unknown>;
  tags?: string[];
  requires?: string[];
}

/** Convert EvaluatorContext to CustomEvalInput wire format */
export function toCustomEvalInput(
  context: EvaluatorContext,
  evaluatorName: string,
  messages?: Array<{ role: string; content: string }>,
): CustomEvalInput {
  const toolCalls = context.toolCalls.map((tc) => {
    const contentParts = tc.result.content
      .map((c) => c.text ?? c.blob ?? '')
      .join('\n');
    return {
      tool: tc.tool,
      args: tc.args,
      result: {
        content: contentParts,
        is_error: tc.result.isError ?? false,
      },
      latency_ms: tc.latencyMs,
    };
  });

  const expected = context.expected
    ? {
        ...(context.expected.tools && { tools: context.expected.tools }),
        ...(context.expected.toolArgs && { tool_args: context.expected.toolArgs }),
        ...(context.expected.toolSequence && { tool_sequence: context.expected.toolSequence }),
        ...(context.expected.responseContains && {
          response_contains: context.expected.responseContains,
        }),
        ...(context.expected.goldenPath && { golden_path: context.expected.goldenPath }),
      }
    : null;

  return {
    protocol_version: PROTOCOL_VERSION,
    evaluator_name: evaluatorName,
    test_name: context.testName,
    prompt: context.prompt ?? null,
    final_output: context.finalOutput ?? null,
    tool_calls: toolCalls,
    expected,
    token_usage: context.tokenUsage ?? null,
    latency_ms: context.latencyMs ?? null,
    adapter: context.adapterName ?? null,
    config: context.config ?? {},
    messages: messages ?? [],
  };
}

/** Convert CustomEvalOutput to EvaluatorResult */
export function fromCustomEvalOutput(
  output: CustomEvalOutput,
  evaluatorName: string,
  threshold: number,
): EvaluatorResult {
  if (output.skipped) {
    return {
      evaluator: evaluatorName,
      score: 0,
      pass: false,
      skipped: true,
      label: 'skipped',
      explanation: output.skip_reason ?? 'Evaluator skipped',
    };
  }

  const score = Math.min(1, Math.max(0, output.score));
  return {
    evaluator: evaluatorName,
    score,
    pass: output.pass ?? score >= threshold,
    label: output.label,
    explanation: output.explanation,
    metadata: output.metadata,
  };
}

/** Validate the output shape from a custom evaluator subprocess */
export function validateCustomEvalOutput(raw: unknown): {
  valid: boolean;
  errors: string[];
  output?: CustomEvalOutput;
} {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { valid: false, errors: ['Output must be a JSON object'] };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj['protocol_version'] !== 'string') {
    errors.push('Missing or invalid "protocol_version" (must be a string)');
  }

  if (typeof obj['score'] !== 'number') {
    errors.push('Missing or invalid "score" (must be a number)');
  } else if (obj['score'] < 0 || obj['score'] > 1) {
    errors.push('"score" must be between 0.0 and 1.0');
  }

  if (typeof obj['pass'] !== 'boolean') {
    errors.push('Missing or invalid "pass" (must be a boolean)');
  }

  if (obj['label'] !== undefined && typeof obj['label'] !== 'string') {
    errors.push('"label" must be a string if present');
  }

  if (obj['explanation'] !== undefined && typeof obj['explanation'] !== 'string') {
    errors.push('"explanation" must be a string if present');
  }

  if (obj['metadata'] !== undefined && (typeof obj['metadata'] !== 'object' || obj['metadata'] === null)) {
    errors.push('"metadata" must be an object if present');
  }

  if (obj['skipped'] !== undefined && typeof obj['skipped'] !== 'boolean') {
    errors.push('"skipped" must be a boolean if present');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], output: obj as unknown as CustomEvalOutput };
}
