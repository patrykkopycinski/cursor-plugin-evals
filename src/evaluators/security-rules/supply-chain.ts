import type { SecurityFinding, SecurityRule } from './types.js';

const SUPPLY_CHAIN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\beval\s*\(/, label: 'eval() call' },
  { pattern: /\bexec\s*\(/, label: 'exec() call' },
  { pattern: /new\s+Function\s*\(/, label: 'dynamic Function constructor' },
  { pattern: /import\s*\(\s*["'`]https?:\/\//, label: 'dynamic import from URL' },
  { pattern: /require\s*\(\s*["'`]https?:\/\//, label: 'require from URL' },
  { pattern: /npm\s+install\s+https?:\/\//, label: 'npm install from URL' },
  { pattern: /pip\s+install\s+https?:\/\//, label: 'pip install from URL' },
  { pattern: /curl\s+[^|]*\|\s*(?:sh|bash|zsh)/, label: 'curl pipe to shell' },
  { pattern: /wget\s+[^|]*\|\s*(?:sh|bash|zsh)/, label: 'wget pipe to shell' },
  { pattern: /\bpickle\.loads?\b/, label: 'pickle deserialization' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class SupplyChainRule implements SecurityRule {
  readonly name = 'supply-chain';
  readonly category = 'supply-chain';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of SUPPLY_CHAIN_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'critical',
          location,
          snippet: extractSnippet(text, match),
          description: `Supply chain risk: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
