export type Severity = 'critical' | 'high' | 'medium';

export interface SecurityFinding {
  rule: string;
  category: string;
  severity: Severity;
  location: string;
  snippet: string;
  description: string;
}

export interface SecurityRule {
  name: string;
  category: string;
  scan(text: string, location: string, context?: RuleContext): SecurityFinding[];
}

export interface RuleContext {
  toolDescriptions?: Map<string, string>;
  toolArgs?: Record<string, unknown>;
}
