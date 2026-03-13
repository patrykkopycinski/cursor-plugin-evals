export type DriftKind =
  | 'hidden_required'
  | 'type_mismatch'
  | 'undeclared_constraint'
  | 'enum_mismatch'
  | 'additional_properties_rejected'
  | 'missing_error_on_invalid'
  | 'accepts_invalid_type';

export interface DriftFinding {
  tool: string;
  field: string;
  kind: DriftKind;
  declared: string;
  actual: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface ProbeInput {
  tool: string;
  description: string;
  args: Record<string, unknown>;
  expectation: 'should_succeed' | 'should_fail';
  targetField?: string;
}

export interface ProbeResult {
  input: ProbeInput;
  success: boolean;
  isError: boolean;
  errorMessage?: string;
  drift?: DriftFinding;
}

export interface SchemaDriftReport {
  toolsAnalyzed: number;
  probesRun: number;
  findings: DriftFinding[];
  probeResults: ProbeResult[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  driftScore: number;
}
