export type GuardrailAction = 'block' | 'warn' | 'log';

export interface GuardrailRule {
  /** Name of the evaluator or security rule to promote */
  evaluator: string;
  /** Action to take when the rule triggers */
  action: GuardrailAction;
  /** Optional score threshold — block if score would be below this */
  threshold?: number;
  /** Optional tool name filter — only apply to these tools */
  tools?: string[];
  /** Optional pattern to match in tool args */
  argPatterns?: Array<{ field: string; pattern: string; action: GuardrailAction }>;
}

export interface GuardrailConfig {
  enabled: boolean;
  rules: GuardrailRule[];
  /** Log all intercepted calls to this file */
  auditLog?: string;
  /** Callback for intercepted calls */
  onIntercept?: (event: GuardrailEvent) => void;
}

export interface GuardrailEvent {
  timestamp: number;
  tool: string;
  args: Record<string, unknown>;
  rule: string;
  action: GuardrailAction;
  reason: string;
  blocked: boolean;
}

export interface InterceptResult {
  allowed: boolean;
  action: GuardrailAction;
  rule?: string;
  reason?: string;
  events: GuardrailEvent[];
}
