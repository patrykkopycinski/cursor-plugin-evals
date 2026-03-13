import type { SecurityFinding, SecurityRule, RuleContext } from './types.js';

const MUTATION_VERBS = /\b(?:create|update|delete|insert|modify|write|put|post|patch|remove|drop)\b/i;
const AUDIT_INDICATORS = /\b(?:log|audit|trace|telemetry|track|record|monitor|event)\b/i;

export class MissingAuditRule implements SecurityRule {
  readonly name = 'missing-audit';
  readonly category = 'missing-audit';

  scan(_text: string, _location: string, context?: RuleContext): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    if (!context?.toolDescriptions) return findings;

    for (const [toolName, description] of context.toolDescriptions) {
      if (MUTATION_VERBS.test(description) && !AUDIT_INDICATORS.test(description)) {
        const verbMatch = MUTATION_VERBS.exec(description);
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'medium',
          location: `tool:${toolName}`,
          snippet: description.slice(0, 120),
          description: `Tool "${toolName}" performs mutations ("${verbMatch?.[1]}") without audit/logging indicators`,
        });
      }
    }

    return findings;
  }
}
