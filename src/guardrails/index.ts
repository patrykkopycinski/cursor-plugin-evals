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
