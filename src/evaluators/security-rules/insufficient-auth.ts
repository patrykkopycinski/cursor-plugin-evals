import type { SecurityFinding, SecurityRule, RuleContext } from './types.js';

const AUTH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /auth\s*[=:]\s*["']?none["']?/i, label: 'auth explicitly set to none' },
  { pattern: /no[_-]?auth/i, label: 'no-auth flag' },
  { pattern: /anonymous\s+access/i, label: 'anonymous access' },
  { pattern: /password\s*[=:]\s*["']?(?:admin|password|root|default|123456)["']?/i, label: 'default/weak password' },
  { pattern: /username\s*[=:]\s*["']?admin["']?\s*[,;]?\s*password\s*[=:]\s*["']?admin["']?/i, label: 'admin:admin credentials' },
  { pattern: /skip[_-]?auth/i, label: 'auth skip flag' },
  { pattern: /allow[_-]?unauthenticated/i, label: 'allow unauthenticated flag' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class InsufficientAuthRule implements SecurityRule {
  readonly name = 'insufficient-auth';
  readonly category = 'insufficient-auth';

  scan(text: string, location: string, _context?: RuleContext): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of AUTH_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'high',
          location,
          snippet: extractSnippet(text, match),
          description: `Insufficient auth: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
