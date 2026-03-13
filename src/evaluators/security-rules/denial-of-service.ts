import type { SecurityFinding, SecurityRule } from './types.js';

const DOS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /while\s*\(\s*true\s*\)/, label: 'while(true) infinite loop' },
  { pattern: /for\s*\(\s*;\s*;\s*\)/, label: 'for(;;) infinite loop' },
  { pattern: /size\s*[=:]\s*["']?\d{7,}["']?/, label: 'extremely large size parameter' },
  { pattern: /count\s*[=:]\s*["']?\d{6,}["']?/, label: 'extremely large count parameter' },
  { pattern: /limit\s*[=:]\s*["']?\d{7,}["']?/, label: 'extremely large limit parameter' },
  { pattern: /depth\s*[=:]\s*["']?\d{4,}["']?/, label: 'excessive recursion depth' },
  { pattern: /(?:zip|tar|gzip)\s+bomb/i, label: 'archive bomb reference' },
  { pattern: /fork\s*\(\s*\)/i, label: 'fork bomb pattern' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class DenialOfServiceRule implements SecurityRule {
  readonly name = 'denial-of-service';
  readonly category = 'denial-of-service';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of DOS_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'high',
          location,
          snippet: extractSnippet(text, match),
          description: `Denial of service: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
