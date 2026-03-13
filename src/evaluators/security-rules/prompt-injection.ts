import type { SecurityFinding, SecurityRule } from './types.js';

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /<\|system\|>/i, label: '<|system|> marker' },
  { pattern: /\[SYSTEM\]/i, label: '[SYSTEM] marker' },
  { pattern: /\[INST\]/i, label: '[INST] marker' },
  { pattern: /<<\s*SYS\s*>>/i, label: '<<SYS>> delimiter' },
  { pattern: /forget\s+(?:all\s+)?(?:your\s+)?instructions/i, label: 'instruction override' },
  { pattern: /you\s+are\s+now\s+/i, label: 'role reassignment' },
  { pattern: /ignore\s+(?:all\s+)?previous\s+/i, label: 'previous context erasure' },
  { pattern: /disregard\s+(?:all\s+)?(?:prior|previous)/i, label: 'disregard directive' },
  { pattern: /\bDAN\s+mode\b/i, label: 'DAN (Do Anything Now) jailbreak' },
  { pattern: /developer\s+mode\s+(?:enabled|override|activated)/i, label: 'developer mode override' },
  { pattern: /\bjailbreak\b/i, label: 'jailbreak keyword' },
  { pattern: /act\s+as\s+(?:if\s+)?(?:you\s+)?(?:have\s+)?no\s+(?:restrictions|limitations)/i, label: 'restriction removal' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 30);
  const end = Math.min(text.length, match.index + match[0].length + 30);
  return text.slice(start, end);
}

export class PromptInjectionRule implements SecurityRule {
  readonly name = 'prompt-injection';
  readonly category = 'prompt-injection';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of INJECTION_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'critical',
          location,
          snippet: extractSnippet(text, match),
          description: `Prompt injection: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
