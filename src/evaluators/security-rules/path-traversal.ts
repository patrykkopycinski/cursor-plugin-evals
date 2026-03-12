import type { SecurityFinding, SecurityRule } from './types.js';

const TRAVERSAL_PATTERN = /((?:\.\.\/){1,})/;

const SENSITIVE_DIRS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\/etc\//i, label: '/etc/' },
  { pattern: /\/proc\//i, label: '/proc/' },
  { pattern: /\/sys\//i, label: '/sys/' },
  { pattern: /\/var\/log\//i, label: '/var/log/' },
  { pattern: /C:\\Windows\\/i, label: 'C:\\Windows\\' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class PathTraversalRule implements SecurityRule {
  readonly name = 'path-traversal';
  readonly category = 'path-traversal';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    const traversalMatch = TRAVERSAL_PATTERN.exec(text);
    if (traversalMatch) {
      const depth = (traversalMatch[1].match(/\.\.\//g) ?? []).length;
      findings.push({
        rule: this.name,
        category: this.category,
        severity: depth >= 3 ? 'high' : 'medium',
        location,
        snippet: extractSnippet(text, traversalMatch),
        description: `Path traversal: ${depth}-level "../" sequence detected`,
      });
    }

    for (const { pattern, label } of SENSITIVE_DIRS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'high',
          location,
          snippet: extractSnippet(text, match),
          description: `Absolute path to sensitive directory: ${label}`,
        });
      }
    }

    return findings;
  }
}
