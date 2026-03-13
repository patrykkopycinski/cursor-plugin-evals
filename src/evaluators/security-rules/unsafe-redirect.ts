import type { SecurityFinding, SecurityRule } from './types.js';

const REDIRECT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /redirect_uri\s*=\s*https?:\/\//, label: 'redirect_uri with external URL' },
  { pattern: /return_to\s*=\s*https?:\/\//, label: 'return_to with external URL' },
  { pattern: /[?&]next=https?:\/\//, label: 'next= parameter with external URL' },
  { pattern: /[?&]url=https?:\/\//, label: 'url= parameter with external URL' },
  { pattern: /[?&]continue=https?:\/\//, label: 'continue= parameter with external URL' },
  { pattern: /[?&]dest(?:ination)?=https?:\/\//, label: 'destination parameter with external URL' },
  { pattern: /Location\s*:\s*https?:\/\//, label: 'Location header redirect' },
  { pattern: /window\.location\s*=\s*["'`]https?:\/\//, label: 'JavaScript redirect' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class UnsafeRedirectRule implements SecurityRule {
  readonly name = 'unsafe-redirect';
  readonly category = 'unsafe-redirect';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of REDIRECT_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'medium',
          location,
          snippet: extractSnippet(text, match),
          description: `Unsafe redirect: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
