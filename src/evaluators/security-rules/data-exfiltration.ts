import type { SecurityFinding, SecurityRule } from './types.js';

const EXFILTRATION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /https?:\/\/[^\s]+\?[^\s]*(?:data|payload|body|content)=[^\s]+/, label: 'data in URL query parameter' },
  { pattern: /curl\s+.*--data\b/, label: 'curl with POST data' },
  { pattern: /curl\s+.*-d\s+/, label: 'curl -d data upload' },
  { pattern: /wget\s+.*--post-data\b/, label: 'wget with POST data' },
  { pattern: /webhook\.site/i, label: 'webhook.site data sink' },
  { pattern: /requestbin\.com/i, label: 'requestbin data sink' },
  { pattern: /pipedream\.net/i, label: 'pipedream data sink' },
  { pattern: /https?:\/\/[^\s]+\/[A-Za-z0-9+/]{40,}/, label: 'base64 encoded data in URL path' },
  { pattern: /fetch\s*\(\s*["'`]https?:\/\/[^"'`]+["'`]\s*,\s*\{[^}]*method\s*:\s*["'`]POST["'`]/i, label: 'fetch POST to external URL' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class DataExfiltrationRule implements SecurityRule {
  readonly name = 'data-exfiltration';
  readonly category = 'data-exfiltration';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of EXFILTRATION_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'critical',
          location,
          snippet: extractSnippet(text, match),
          description: `Data exfiltration: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
