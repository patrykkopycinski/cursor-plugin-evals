import type { SecurityFinding, SecurityRule } from './types.js';

const OVERSHARING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /SELECT\s+\*\s+FROM/i, label: 'SELECT * query (all fields)' },
  { pattern: /process\.env\b/, label: 'process.env access' },
  { pattern: /\/etc\/passwd\b/, label: '/etc/passwd access' },
  { pattern: /\.env\s+dump/i, label: 'environment dump' },
  { pattern: /printenv\b/, label: 'printenv command' },
  { pattern: /env\s*\|\s*sort/i, label: 'sorted env listing' },
  { pattern: /credential[_-]?store/i, label: 'credential store access' },
  { pattern: /size\s*[=:]\s*["']?-1["']?/, label: 'unbounded query (size: -1)' },
  { pattern: /_source\s*[=:]\s*\[?\s*["']?\*["']?\]?/, label: 'all source fields' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class ContextOversharingRule implements SecurityRule {
  readonly name = 'context-oversharing';
  readonly category = 'context-oversharing';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of OVERSHARING_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'high',
          location,
          snippet: extractSnippet(text, match),
          description: `Context oversharing: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
