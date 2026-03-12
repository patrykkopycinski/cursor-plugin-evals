import type { SecurityFinding, SecurityRule, Severity } from './types.js';

interface CredentialPattern {
  name: string;
  pattern: RegExp;
  severity: Severity;
}

const CREDENTIAL_PATTERNS: CredentialPattern[] = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/, severity: 'high' },
  { name: 'AWS Secret Key', pattern: /(?:aws_secret_access_key|secret_key)\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}["']?/i, severity: 'critical' },
  { name: 'Bearer Token', pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i, severity: 'high' },
  { name: 'Basic Auth', pattern: /Basic\s+[A-Za-z0-9+/]+=*/i, severity: 'high' },
  { name: 'API Key Header', pattern: /(?:x-api-key|apikey|api_key)\s*[=:]\s*["']?[A-Za-z0-9\-._]{16,}["']?/i, severity: 'high' },
  { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*["']?[A-Za-z0-9\-._]{20,}["']?/i, severity: 'high' },
  { name: 'Password Field', pattern: /(?:password|passwd|pwd)\s*[=:]\s*["']?[^\s"']{8,}["']?/i, severity: 'high' },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, severity: 'critical' },
  { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/, severity: 'high' },
  { name: 'Slack Token', pattern: /xox[bporas]-[A-Za-z0-9\-]+/, severity: 'high' },
  { name: 'Elastic API Key', pattern: /(?:elastic|es)[\s_-]*(?:api[\s_-]*key)\s*[=:]\s*["']?[A-Za-z0-9\-._]{20,}["']?/i, severity: 'high' },
  { name: 'Generic Secret', pattern: /(?:secret|token|credential)\s*[=:]\s*["']?[A-Za-z0-9\-._/+=]{20,}["']?/i, severity: 'medium' },
  { name: 'Connection String', pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s]+:[^\s]+@/i, severity: 'high' },
  { name: 'GCP Service Account Key', pattern: /"type"\s*:\s*"service_account"/, severity: 'critical' },
  { name: 'Azure Subscription Key', pattern: /(?:Ocp-Apim-Subscription-Key|azure[_-]?(?:api[_-]?)?key)\s*[=:]\s*["']?[A-Fa-f0-9]{32}["']?/i, severity: 'high' },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/, severity: 'high' },
  { name: 'PEM Certificate', pattern: /-----BEGIN CERTIFICATE-----/, severity: 'medium' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  const raw = text.slice(start, end);
  return raw.replace(match[0], match[0].slice(0, 4) + '***REDACTED***');
}

export class CredentialExposureRule implements SecurityRule {
  readonly name = 'credential-exposure';
  readonly category = 'credential-exposure';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { name, pattern, severity } of CREDENTIAL_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity,
          location,
          snippet: extractSnippet(text, match),
          description: `Credential exposure: ${name} detected`,
        });
      }
    }

    return findings;
  }
}

export { CREDENTIAL_PATTERNS };
