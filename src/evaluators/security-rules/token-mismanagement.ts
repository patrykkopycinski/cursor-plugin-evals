import type { SecurityFinding, SecurityRule, Severity } from './types.js';

interface TokenPattern {
  name: string;
  pattern: RegExp;
  severity: Severity;
}

const TOKEN_PATTERNS: TokenPattern[] = [
  {
    name: 'Bearer Token in Output',
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/i,
    severity: 'critical',
  },
  {
    name: 'OAuth Token',
    pattern: /oauth_token\s*[=:]\s*["']?[A-Za-z0-9\-._~+/]{16,}["']?/i,
    severity: 'critical',
  },
  {
    name: 'Access Token Assignment',
    pattern: /access_token\s*[=:]\s*["']?[A-Za-z0-9\-._~+/]{16,}["']?/i,
    severity: 'critical',
  },
  {
    name: 'Refresh Token',
    pattern: /refresh_token\s*[=:]\s*["']?[A-Za-z0-9\-._~+/]{16,}["']?/i,
    severity: 'critical',
  },
  {
    name: 'JWT in Tool Output',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/,
    severity: 'critical',
  },
  {
    name: 'Session Token',
    pattern: /session_token\s*[=:]\s*["']?[A-Za-z0-9\-._]{16,}["']?/i,
    severity: 'high',
  },
  {
    name: 'Token in URL Query',
    pattern: /[?&](?:token|access_token|auth)=[A-Za-z0-9\-._~+/]{16,}/i,
    severity: 'critical',
  },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  const raw = text.slice(start, end);
  return raw.replace(match[0], match[0].slice(0, 6) + '***REDACTED***');
}

export class TokenMismanagementRule implements SecurityRule {
  readonly name = 'token-mismanagement';
  readonly category = 'token-mismanagement';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { name, pattern, severity } of TOKEN_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity,
          location,
          snippet: extractSnippet(text, match),
          description: `Token mismanagement: ${name} detected`,
        });
      }
    }

    return findings;
  }
}
