export interface RunCheck {
  type:
    | 'max_iterations'
    | 'call_count'
    | 'success_rate'
    | 'total_tools'
    | 'no_errors'
    | 'output_matches'
    | 'latency_under';
  tool?: string;
  value?: number;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface RunCheckContext {
  toolCalls: Array<{ tool: string; success: boolean; latencyMs: number }>;
  iterations: number;
  finalOutput: string;
  totalLatencyMs: number;
}

export interface RunCheckResult {
  check: RunCheck;
  pass: boolean;
  explanation: string;
}

export class RunAssertion {
  private checks: RunCheck[] = [];

  maxIterations(n: number): this {
    this.checks.push({ type: 'max_iterations', value: n });
    return this;
  }

  callCount(tool: string, min: number, max?: number): this {
    this.checks.push({ type: 'call_count', tool, min, max });
    return this;
  }

  successRate(threshold: number): this {
    this.checks.push({ type: 'success_rate', value: threshold });
    return this;
  }

  totalTools(min: number, max?: number): this {
    this.checks.push({ type: 'total_tools', min, max });
    return this;
  }

  noErrors(): this {
    this.checks.push({ type: 'no_errors' });
    return this;
  }

  outputMatches(pattern: string): this {
    this.checks.push({ type: 'output_matches', pattern });
    return this;
  }

  latencyUnder(ms: number): this {
    this.checks.push({ type: 'latency_under', value: ms });
    return this;
  }

  toChecks(): RunCheck[] {
    return [...this.checks];
  }
}

export function evaluateRunChecks(checks: RunCheck[], context: RunCheckContext): RunCheckResult[] {
  return checks.map((check) => evaluateSingleCheck(check, context));
}

function evaluateSingleCheck(check: RunCheck, ctx: RunCheckContext): RunCheckResult {
  switch (check.type) {
    case 'max_iterations': {
      const limit = check.value!;
      const pass = ctx.iterations <= limit;
      return {
        check,
        pass,
        explanation: pass
          ? `Completed in ${ctx.iterations} iterations (limit: ${limit})`
          : `Used ${ctx.iterations} iterations, exceeding limit of ${limit}`,
      };
    }

    case 'call_count': {
      const count = ctx.toolCalls.filter((tc) => tc.tool === check.tool).length;
      const min = check.min ?? 0;
      const max = check.max;
      const pass = count >= min && (max === undefined || count <= max);
      const range = max !== undefined ? `${min}-${max}` : `>=${min}`;
      return {
        check,
        pass,
        explanation: pass
          ? `Tool "${check.tool}" called ${count} times (expected: ${range})`
          : `Tool "${check.tool}" called ${count} times, expected ${range}`,
      };
    }

    case 'success_rate': {
      const total = ctx.toolCalls.length;
      if (total === 0) {
        return {
          check,
          pass: true,
          explanation: 'No tool calls to evaluate success rate',
        };
      }
      const successes = ctx.toolCalls.filter((tc) => tc.success).length;
      const rate = (successes / total) * 100;
      const threshold = check.value!;
      const pass = rate >= threshold;
      return {
        check,
        pass,
        explanation: pass
          ? `Success rate ${rate.toFixed(1)}% meets threshold of ${threshold}%`
          : `Success rate ${rate.toFixed(1)}% below threshold of ${threshold}%`,
      };
    }

    case 'total_tools': {
      const total = ctx.toolCalls.length;
      const min = check.min ?? 0;
      const max = check.max;
      const pass = total >= min && (max === undefined || total <= max);
      const range = max !== undefined ? `${min}-${max}` : `>=${min}`;
      return {
        check,
        pass,
        explanation: pass
          ? `Total tool calls: ${total} (expected: ${range})`
          : `Total tool calls: ${total}, expected ${range}`,
      };
    }

    case 'no_errors': {
      const errors = ctx.toolCalls.filter((tc) => !tc.success);
      const pass = errors.length === 0;
      return {
        check,
        pass,
        explanation: pass
          ? 'No tool call errors'
          : `${errors.length} tool call(s) returned errors: ${errors.map((e) => e.tool).join(', ')}`,
      };
    }

    case 'output_matches': {
      const pattern = check.pattern!;
      let pass: boolean;
      try {
        pass = new RegExp(pattern).test(ctx.finalOutput);
      } catch (_e) {
        pass = false;
      }
      return {
        check,
        pass,
        explanation: pass
          ? `Final output matches pattern /${pattern}/`
          : `Final output does not match pattern /${pattern}/`,
      };
    }

    case 'latency_under': {
      const limit = check.value!;
      const pass = ctx.totalLatencyMs < limit;
      return {
        check,
        pass,
        explanation: pass
          ? `Total latency ${ctx.totalLatencyMs}ms under limit of ${limit}ms`
          : `Total latency ${ctx.totalLatencyMs}ms exceeds limit of ${limit}ms`,
      };
    }
  }
}
