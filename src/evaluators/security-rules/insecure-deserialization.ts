import type { SecurityFinding, SecurityRule } from './types.js';

const DESERIALIZATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /pickle\.loads?\b/, label: 'Python pickle deserialization' },
  { pattern: /yaml\.unsafe_load\b/, label: 'YAML unsafe_load' },
  { pattern: /yaml\.load\s*\([^)]*Loader\s*=\s*yaml\.Loader/i, label: 'YAML load without SafeLoader' },
  { pattern: /Marshal\.load\b/, label: 'Ruby Marshal.load' },
  { pattern: /unserialize\s*\(/, label: 'PHP unserialize' },
  { pattern: /ObjectInputStream/, label: 'Java ObjectInputStream deserialization' },
  { pattern: /readObject\s*\(/, label: 'Java readObject' },
  { pattern: /BinaryFormatter\s*\.\s*Deserialize/, label: '.NET BinaryFormatter deserialization' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class InsecureDeserializationRule implements SecurityRule {
  readonly name = 'insecure-deserialization';
  readonly category = 'insecure-deserialization';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of DESERIALIZATION_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'high',
          location,
          snippet: extractSnippet(text, match),
          description: `Insecure deserialization: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
