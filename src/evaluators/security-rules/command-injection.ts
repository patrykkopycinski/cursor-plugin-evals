import type { SecurityFinding, SecurityRule } from './types.js';

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /;\s*(?:rm|cat|ls|wget|curl|nc)\b/, label: 'semicolon command chaining' },
  { pattern: /&&\s*(?:rm|cat|ls|wget|curl|nc)\b/, label: '&& command chaining' },
  { pattern: /\|\|\s*(?:rm|cat|ls|wget|curl|nc)\b/, label: '|| command chaining' },
  { pattern: /\|\s*(?:sh|bash|zsh|cmd)\b/, label: 'pipe to shell' },
  { pattern: /\$\([^)]+\)/, label: 'subshell execution $()' },
  { pattern: /(?:^|[=\s])(`[^`]*(?:rm|cat|ls|wget|curl|nc|sh|bash|chmod|chown|kill|shutdown|whoami|id|passwd|sudo|dd|mkfs)[^`]*`)/, label: 'backtick subshell execution' },
  { pattern: /\$\{(?:PATH|HOME|USER|SHELL|PWD|HOSTNAME|IFS|TERM)[^}]*\}/, label: 'environment variable expansion' },
  { pattern: />\s*\/(?:etc|tmp|dev)\//, label: 'redirect to sensitive path' },
  { pattern: /;\s*(?:chmod|chown|kill|shutdown|reboot)\b/, label: 'chained destructive command' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class CommandInjectionRule implements SecurityRule {
  readonly name = 'command-injection';
  readonly category = 'command-injection';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    const isFinalOutput = location === 'finalOutput' || location.includes('finalOutput');

    for (const { pattern, label } of INJECTION_PATTERNS) {
      // Backtick patterns in finalOutput are almost always markdown formatting,
      // not actual command injection. Only flag them in tool call arguments.
      if (isFinalOutput && label === 'backtick subshell execution') continue;

      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'critical',
          location,
          snippet: extractSnippet(text, match),
          description: `Command injection: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
