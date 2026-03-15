import type { SecurityFinding, SecurityRule } from './types.js';

const METADATA_ENDPOINT = /169\.254\.169\.254/;

const INTERNAL_IP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /127\.0\.0\.1/, label: '127.0.0.1 (loopback)' },
  { pattern: /\blocalhost\b/i, label: 'localhost' },
  { pattern: /\b0\.0\.0\.0\b/, label: '0.0.0.0 (all interfaces)' },
  { pattern: METADATA_ENDPOINT, label: '169.254.169.254 (cloud metadata)' },
  { pattern: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, label: '10.x.x.x (RFC 1918)' },
  { pattern: /\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/, label: '172.16-31.x.x (RFC 1918)' },
  { pattern: /\b192\.168\.\d{1,3}\.\d{1,3}\b/, label: '192.168.x.x (RFC 1918)' },
];

const FILE_PROTOCOL = /file:\/\//i;

function extractSnippet(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  return text.slice(start, end);
}

export class SsrfRule implements SecurityRule {
  readonly name = 'ssrf-detection';
  readonly category = 'ssrf';

  scan(text: string, location: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    const isToolResult = location.includes('.result');

    for (const { pattern, label } of INTERNAL_IP_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        const isMetadata = METADATA_ENDPOINT.test(match[0]);
        if (isToolResult && !isMetadata) continue;

        findings.push({
          rule: this.name,
          category: this.category,
          severity: isMetadata ? 'high' : 'medium',
          location,
          snippet: extractSnippet(text, match),
          description: `Potential SSRF: internal address ${label} detected`,
        });
      }
    }

    const fileMatch = FILE_PROTOCOL.exec(text);
    if (fileMatch) {
      findings.push({
        rule: this.name,
        category: this.category,
        severity: 'high',
        location,
        snippet: extractSnippet(text, fileMatch),
        description: 'Potential SSRF: file:// protocol URI detected',
      });
    }

    return findings;
  }
}
