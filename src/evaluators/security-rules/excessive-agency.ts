import type { SecurityFinding, SecurityRule, RuleContext } from './types.js';

const DESTRUCTIVE_VERBS = /\b(DELETE|DROP|TRUNCATE|DESTROY|REMOVE|WIPE)\b/i;
const SAFEGUARD_TERMS = /\b(confirm|confirmation|warning|dry[- ]?run|preview)\b/i;

export class ExcessiveAgencyRule implements SecurityRule {
  readonly name = 'excessive-agency';
  readonly category = 'excessive-agency';

  scan(_text: string, _location: string, context?: RuleContext): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    if (!context?.toolDescriptions) return findings;

    for (const [toolName, description] of context.toolDescriptions) {
      if (DESTRUCTIVE_VERBS.test(description) && !SAFEGUARD_TERMS.test(description)) {
        const verbMatch = DESTRUCTIVE_VERBS.exec(description);
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'high',
          location: `tool:${toolName}`,
          snippet: description.slice(0, 120),
          description: `Tool "${toolName}" has destructive verb "${verbMatch?.[1]}" without confirmation safeguards`,
        });
      }
    }

    return findings;
  }
}
