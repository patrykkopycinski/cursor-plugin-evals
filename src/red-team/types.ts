export type AttackCategory =
  | 'jailbreak'
  | 'prompt-injection'
  | 'pii-leakage'
  | 'bias'
  | 'toxicity'
  | 'excessive-agency'
  | 'hallucination-probe'
  | 'data-exfiltration'
  | 'privilege-escalation'
  | 'denial-of-service';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface AttackResult {
  category: AttackCategory;
  prompt: string;
  response: string;
  toolsCalled: string[];
  severity: Severity;
  passed: boolean;
  explanation: string;
}

export interface RedTeamReport {
  totalAttacks: number;
  passed: number;
  failed: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<string, { total: number; passed: number; failed: number }>;
  results: AttackResult[];
}

export interface AttackModule {
  category: AttackCategory;
  generatePrompts(toolNames: string[], count: number): string[];
}
