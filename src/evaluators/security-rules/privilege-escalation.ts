import type { SecurityFinding, SecurityRule, RuleContext } from './types.js';

const ESCALATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bsudo\s+/i, label: 'sudo command' },
  { pattern: /\brunas\s*[=:]/i, label: 'runas directive' },
  { pattern: /\bsu\s+-\s*\w+/i, label: 'su user switch' },
  { pattern: /--privileged\b/i, label: 'privileged container flag' },
  { pattern: /\/admin\//i, label: 'admin endpoint path' },
  { pattern: /role\s*[=:]\s*["']?(?:admin|superuser|root)["']?/i, label: 'admin role assignment' },
  { pattern: /chmod\s+[0-7]*[4-7][0-7]{2}\b/, label: 'permissive chmod' },
  { pattern: /setuid|setgid/i, label: 'setuid/setgid manipulation' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class PrivilegeEscalationRule implements SecurityRule {
  readonly name = 'privilege-escalation';
  readonly category = 'privilege-escalation';

  scan(text: string, location: string, context?: RuleContext): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of ESCALATION_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'critical',
          location,
          snippet: extractSnippet(text, match),
          description: `Privilege escalation: ${label} detected`,
        });
      }
    }

    if (context?.toolArgs) {
      const argsStr = JSON.stringify(context.toolArgs);
      const userMatch = /(?:user|username)\s*[=:]\s*["']?(?:root|admin|Administrator)["']?/i.exec(
        argsStr,
      );
      if (userMatch) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'critical',
          location,
          snippet: argsStr.slice(0, 120),
          description: 'Privilege escalation: tool arguments specify privileged user',
        });
      }
    }

    return findings;
  }
}
