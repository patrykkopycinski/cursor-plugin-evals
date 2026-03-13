import type { SecurityFinding, SecurityRule } from './types.js';

const SHADOW_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /localhost:\d{5}/, label: 'localhost with high port' },
  { pattern: /\.ngrok\.\w+/i, label: 'ngrok tunnel URL' },
  { pattern: /\.localtunnel\.me/i, label: 'localtunnel URL' },
  { pattern: /\.serveo\.net/i, label: 'serveo tunnel URL' },
  { pattern: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+/, label: 'internal IP with port' },
  { pattern: /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}:\d+/, label: 'RFC 1918 address with port' },
  { pattern: /\b192\.168\.\d{1,3}\.\d{1,3}:\d+/, label: 'private network address with port' },
  { pattern: /\.onion\b/, label: 'Tor hidden service' },
];

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class ShadowServerRule implements SecurityRule {
  readonly name = 'shadow-server';
  readonly category = 'shadow-server';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const { pattern, label } of SHADOW_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        findings.push({
          rule: this.name,
          category: this.category,
          severity: 'high',
          location,
          snippet: extractSnippet(text, match),
          description: `Shadow server: ${label} detected`,
        });
      }
    }

    return findings;
  }
}
