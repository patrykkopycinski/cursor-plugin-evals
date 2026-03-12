import type { Evaluator, EvaluatorContext, EvaluatorResult, ToolCallRecord } from '../core/types.js';

interface ValidationResult {
  tool: string;
  valid: boolean;
  issues: string[];
}

const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_.\-/]*$/;

function validateToolCall(tc: ToolCallRecord): ValidationResult {
  const issues: string[] = [];

  if (!tc.tool || typeof tc.tool !== 'string') {
    issues.push('Missing or non-string tool name.');
  } else if (!TOOL_NAME_RE.test(tc.tool)) {
    issues.push(`Invalid tool name format: "${tc.tool}".`);
  }

  if (tc.args === null || tc.args === undefined) {
    issues.push('Arguments are null or undefined.');
  } else if (typeof tc.args !== 'object' || Array.isArray(tc.args)) {
    issues.push(`Arguments must be a plain object, got ${Array.isArray(tc.args) ? 'array' : typeof tc.args}.`);
  } else {
    try {
      JSON.stringify(tc.args);
    } catch {
      issues.push('Arguments are not JSON-serializable.');
    }
  }

  if (tc.result) {
    if (tc.result.isError) {
      issues.push(`Tool returned an error response.`);
    }

    if (!Array.isArray(tc.result.content)) {
      issues.push('Result content is not an array.');
    } else {
      for (let i = 0; i < tc.result.content.length; i++) {
        const item = tc.result.content[i];
        if (!item.type || typeof item.type !== 'string') {
          issues.push(`Result content[${i}] missing valid type field.`);
        }
      }
    }
  }

  return {
    tool: tc.tool ?? '<unknown>',
    valid: issues.length === 0,
    issues,
  };
}

export class McpProtocolEvaluator implements Evaluator {
  readonly name = 'mcp-protocol';

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const toolCalls = context.toolCalls;

    if (toolCalls.length === 0) {
      return {
        evaluator: this.name,
        score: 1.0,
        pass: true,
        label: 'skip',
        explanation: 'No tool calls to validate.',
      };
    }

    const results = toolCalls.map(validateToolCall);
    const valid = results.filter((r) => r.valid).length;
    const total = results.length;
    const score = Math.round((valid / total) * 1000) / 1000;
    const invalid = results.filter((r) => !r.valid);

    return {
      evaluator: this.name,
      score,
      pass: valid === total,
      label: valid === total ? 'pass' : 'fail',
      explanation:
        `${valid}/${total} MCP calls are well-formed.` +
        (invalid.length > 0
          ? ` Issues: ${invalid.map((r) => `${r.tool}: ${r.issues.join('; ')}`).join(' | ')}.`
          : ''),
      metadata: {
        total,
        valid,
        invalid: invalid.length,
        details: results,
      },
    };
  }
}
