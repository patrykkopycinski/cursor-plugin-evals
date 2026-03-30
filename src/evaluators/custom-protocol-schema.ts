/**
 * JSON Schema definitions for the custom evaluator protocol.
 * Used for validation and documentation — not the source of type truth.
 */

export const CUSTOM_EVAL_INPUT_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'CustomEvalInput',
  type: 'object',
  required: [
    'protocol_version',
    'evaluator_name',
    'test_name',
    'tool_calls',
    'config',
    'messages',
  ],
  properties: {
    protocol_version: { type: 'string', description: 'Protocol version, e.g. "1.0"' },
    evaluator_name: { type: 'string' },
    test_name: { type: 'string' },
    prompt: { type: ['string', 'null'] },
    final_output: { type: ['string', 'null'] },
    tool_calls: {
      type: 'array',
      items: {
        type: 'object',
        required: ['tool', 'args', 'result', 'latency_ms'],
        properties: {
          tool: { type: 'string' },
          args: { type: 'object' },
          result: {
            type: 'object',
            required: ['content', 'is_error'],
            properties: {
              content: { type: 'string' },
              is_error: { type: 'boolean' },
            },
          },
          latency_ms: { type: 'number' },
        },
      },
    },
    expected: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            tools: { type: 'array', items: { type: 'string' } },
            tool_args: { type: 'object' },
            tool_sequence: { type: 'array', items: { type: 'string' } },
            response_contains: { type: 'array', items: { type: 'string' } },
            response_pattern: { type: 'string' },
            golden_path: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: true,
        },
      ],
    },
    token_usage: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          required: ['input', 'output'],
          properties: {
            input: { type: 'number' },
            output: { type: 'number' },
            cached: { type: 'number' },
          },
        },
      ],
    },
    latency_ms: { type: ['number', 'null'] },
    adapter: { type: ['string', 'null'] },
    config: { type: 'object' },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
  },
  additionalProperties: false,
};

export const CUSTOM_EVAL_OUTPUT_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'CustomEvalOutput',
  type: 'object',
  required: ['protocol_version', 'score', 'pass'],
  properties: {
    protocol_version: { type: 'string' },
    score: { type: 'number', minimum: 0, maximum: 1 },
    pass: { type: 'boolean' },
    label: { type: 'string' },
    explanation: { type: 'string' },
    metadata: { type: 'object' },
    skipped: { type: 'boolean' },
    skip_reason: { type: 'string' },
  },
  additionalProperties: false,
};

export const EVALUATOR_MANIFEST_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'EvaluatorManifest',
  type: 'object',
  required: ['name', 'version', 'description', 'language', 'entry', 'protocol_version'],
  properties: {
    name: { type: 'string' },
    version: { type: 'string' },
    description: { type: 'string' },
    author: { type: 'string' },
    language: {
      type: 'string',
      enum: ['python', 'typescript', 'javascript', 'go', 'rust', 'shell'],
    },
    entry: { type: 'string', description: 'Relative path to executable entry point' },
    protocol_version: { type: 'string' },
    config_schema: {
      type: 'object',
      description: 'JSON Schema for evaluator-specific config',
    },
    tags: { type: 'array', items: { type: 'string' } },
    requires: {
      type: 'array',
      items: { type: 'string' },
      description: 'Required env vars or tools',
    },
  },
  additionalProperties: false,
};
