import { appendFileSync } from 'node:fs';
import type { GuardrailConfig, GuardrailEvent, InterceptResult } from './types.js';
import { interceptToolCall } from './interceptor.js';

export type { GuardrailAction, GuardrailConfig, GuardrailEvent, InterceptResult } from './types.js';
export type { GuardrailRule as PromotedGuardrailRule } from './types.js';
export { interceptToolCall } from './interceptor.js';

// ---------------------------------------------------------------------------
// Legacy pattern-based API (preserved for backward compatibility)
// ---------------------------------------------------------------------------

export interface GuardrailRule {
  name: string;
  pattern: RegExp;
  action: 'block' | 'warn' | 'log';
  message?: string;
}

export interface GuardrailViolation {
  rule: string;
  tool: string;
  action: 'block' | 'warn' | 'log';
  message: string;
}

export const DEFAULT_GUARDRAILS: GuardrailRule[] = [
  {
    name: 'block-delete-all',
    pattern: /DELETE.*\/_all|_delete_by_query/i,
    action: 'block',
    message: 'Blocked destructive DELETE operation',
  },
  {
    name: 'block-drop',
    pattern: /DROP\s+(DATABASE|TABLE|INDEX)/i,
    action: 'block',
    message: 'Blocked destructive DROP operation',
  },
];

export function checkGuardrails(
  rules: GuardrailRule[],
  toolName: string,
  args: Record<string, unknown>,
): GuardrailViolation | null {
  const serialized = `${toolName} ${JSON.stringify(args)}`;

  for (const rule of rules) {
    if (rule.pattern.test(serialized)) {
      return {
        rule: rule.name,
        tool: toolName,
        action: rule.action,
        message: rule.message ?? `Guardrail "${rule.name}" triggered on tool "${toolName}"`,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// GuardrailEngine — eval-promoted runtime interceptor
// ---------------------------------------------------------------------------

export class GuardrailEngine {
  private readonly config: GuardrailConfig;
  private readonly events: GuardrailEvent[] = [];
  private totalChecks = 0;

  constructor(config: GuardrailConfig) {
    this.config = config;
  }

  /**
   * Check a tool call against all configured guardrail rules.
   * Call this before executing an MCP tool.
   */
  check(toolName: string, args: Record<string, unknown>): InterceptResult {
    if (!this.config.enabled) {
      return { allowed: true, action: 'log', events: [] };
    }

    this.totalChecks++;
    const result = interceptToolCall(toolName, args, this.config);

    for (const event of result.events) {
      if (this.config.auditLog) {
        try {
          appendFileSync(this.config.auditLog, JSON.stringify(event) + '\n', 'utf8');
        } catch {
          // Best-effort audit logging — don't crash the interceptor on I/O errors
        }
      }

      if (this.config.onIntercept) {
        this.config.onIntercept(event);
      }

      this.events.push(event);
    }

    return result;
  }

  /** Get all recorded guardrail events */
  getEvents(): GuardrailEvent[] {
    return [...this.events];
  }

  /** Get summary statistics */
  getSummary(): {
    totalChecks: number;
    blocked: number;
    warned: number;
    logged: number;
    byRule: Record<string, number>;
  } {
    const blocked = this.events.filter((e) => e.blocked).length;
    const warned = this.events.filter((e) => !e.blocked && e.action === 'warn').length;
    const logged = this.events.filter((e) => !e.blocked && e.action === 'log').length;

    const byRule: Record<string, number> = {};
    for (const event of this.events) {
      byRule[event.rule] = (byRule[event.rule] ?? 0) + 1;
    }

    return { totalChecks: this.totalChecks, blocked, warned, logged, byRule };
  }

  /** Clear recorded events */
  reset(): void {
    this.events.length = 0;
    this.totalChecks = 0;
  }
}
