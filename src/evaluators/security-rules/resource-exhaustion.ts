import type { SecurityFinding, SecurityRule } from './types.js';

const EXHAUSTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /SELECT\s+[^;]*\bFROM\b(?![^;]*\bLIMIT\b)/i, label: 'SQL query without LIMIT clause' },
  { pattern: /size\s*[=:]\s*["']?-1["']?/, label: 'unbounded size parameter (size: -1)' },
  { pattern: /count\s*[=:]\s*["']?999{3,}["']?/, label: 'excessively large count' },
  { pattern: /limit\s*[=:]\s*["']?0["']?/, label: 'limit set to zero (all records)' },
  { pattern: /fetch_all\b/i, label: 'fetch all records pattern' },
  { pattern: /\.find\(\s*\{\s*\}\s*\)/, label: 'MongoDB find({}) with no filter' },
  { pattern: /scan\s*[=:]\s*["']?true["']?/i, label: 'full table scan enabled' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class ResourceExhaustionRule implements SecurityRule {
  readonly name = 'resource-exhaustion';
  readonly category = 'resource-exhaustion';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of EXHAUSTION_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'medium',
          location,
          snippet: extractSnippet(text, match),
          description: `Resource exhaustion: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
