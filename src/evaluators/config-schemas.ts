/**
 * Typed configuration schemas for evaluators that accept config via
 * `context.config`. These provide type-safe resolution from the
 * untyped Record<string, unknown> that flows through the system.
 */

export interface TokenUsageConfig {
  max_input?: number;
  max_output?: number;
  max_total?: number;
}

export interface WorkflowConfig {
  tools_used?: string[];
  files_read?: string[];
  files_written?: string[];
  output_patterns?: string[];
}

export interface SecurityConfig {
  exclude_locations?: string[];
  domain?: string;
}

export interface GroundednessConfig {
  threshold?: number;
}

export function resolveTokenUsageConfig(
  config?: Record<string, unknown>,
): TokenUsageConfig {
  const raw = config?.['token-usage'] as Record<string, unknown> | number | undefined;
  if (typeof raw === 'number') return { max_total: raw };
  if (raw && typeof raw === 'object') {
    return {
      max_input: raw.max_input as number | undefined,
      max_output: raw.max_output as number | undefined,
      max_total: raw.max_total as number | undefined,
    };
  }
  return {};
}

export function resolveWorkflowConfig(
  config?: Record<string, unknown>,
): WorkflowConfig {
  const raw = config?.['workflow'] as Record<string, unknown> | undefined;
  if (!raw) return {};
  return {
    tools_used: raw.tools_used as string[] | undefined,
    files_read: raw.files_read as string[] | undefined,
    files_written: raw.files_written as string[] | undefined,
    output_patterns: raw.output_patterns as string[] | undefined,
  };
}

export function resolveSecurityConfig(
  config?: Record<string, unknown>,
): SecurityConfig {
  const raw = config?.['security'] as Record<string, unknown> | undefined;
  if (!raw) return {};
  return {
    exclude_locations: raw.exclude_locations as string[] | undefined,
    domain: raw.domain as string | undefined,
  };
}

export function resolveGroundednessConfig(
  config?: Record<string, unknown>,
): GroundednessConfig {
  const raw = config?.['groundedness'];
  if (typeof raw === 'number') return { threshold: raw };
  if (raw && typeof raw === 'object') {
    return { threshold: (raw as Record<string, unknown>).threshold as number | undefined };
  }
  return {};
}
