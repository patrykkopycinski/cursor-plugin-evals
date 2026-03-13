import type { SecurityFinding, SecurityRule } from './types.js';

const CONTAMINATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /tool_output\s*[=:]\s*.*tool_input/i, label: 'tool output piped directly to tool input' },
  { pattern: /result\s*\[\s*["']?\w+["']?\s*\]\s*(?:\.|\[)/, label: 'unvalidated tool result field access' },
  { pattern: /JSON\.parse\s*\(\s*(?:result|output|response)\b/, label: 'raw JSON.parse of tool output' },
  { pattern: /\{\s*\.\.\.\s*(?:result|output|response)\s*\}/, label: 'spread of unvalidated tool response' },
  { pattern: /(?:input|args|params)\s*[=:]\s*(?:result|output|response)\./, label: 'direct assignment from tool output to next input' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class CrossToolContaminationRule implements SecurityRule {
  readonly name = 'cross-tool-contamination';
  readonly category = 'cross-tool-contamination';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of CONTAMINATION_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'medium',
          location,
          snippet: extractSnippet(text, match),
          description: `Cross-tool contamination: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
