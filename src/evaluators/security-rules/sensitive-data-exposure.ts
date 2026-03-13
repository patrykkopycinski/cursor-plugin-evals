import type { SecurityFinding, SecurityRule, Severity } from './types.js';

interface PiiPattern {
  name: string;
  pattern: RegExp;
  severity: Severity;
}

const PII_PATTERNS: PiiPattern[] = [
  {
    name: 'US SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/,
    severity: 'high',
  },
  {
    name: 'Credit Card (Visa)',
    pattern: /\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
    severity: 'high',
  },
  {
    name: 'Credit Card (Mastercard)',
    pattern: /\b5[1-5]\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
    severity: 'high',
  },
  {
    name: 'US Phone Number',
    pattern: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    severity: 'high',
  },
  {
    name: 'Email with PII Context',
    pattern: /(?:email|e-mail)\s*[=:]\s*["']?[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}["']?/i,
    severity: 'high',
  },
  {
    name: 'Date of Birth',
    pattern: /(?:dob|date[_\s]of[_\s]birth)\s*[=:]\s*["']?\d{1,4}[\-/]\d{1,2}[\-/]\d{1,4}["']?/i,
    severity: 'high',
  },
  {
    name: 'National ID / Passport',
    pattern: /(?:passport|national[_\s]id)\s*[=:]\s*["']?[A-Z0-9]{6,12}["']?/i,
    severity: 'high',
  },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  const raw = text.slice(start, end);
  return raw.replace(match[0], match[0].slice(0, 4) + '***REDACTED***');
}

export class SensitiveDataExposureRule implements SecurityRule {
  readonly name = 'sensitive-data-exposure';
  readonly category = 'sensitive-data-exposure';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { name, pattern, severity } of PII_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity,
          location,
          snippet: extractSnippet(text, match),
          description: `Sensitive data exposure: ${name} detected`,
        });
      }
    }

    return findings;
  }
}
