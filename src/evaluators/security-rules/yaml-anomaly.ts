import type { SecurityRule, SecurityFinding, RuleContext } from './types.js';

const DANGEROUS_TAG_RE = /!!(python|ruby|java|perl|php)\//gi;
const ANCHOR_RE = /\*\w+/g;
const MAX_VALUE_LENGTH = 10_000;

export class YamlAnomalyRule implements SecurityRule {
  name = 'yaml-anomaly';
  category = 'yaml-anomaly';

  scan(text: string, location: string, _context?: RuleContext): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    const tagMatches = text.match(DANGEROUS_TAG_RE);
    if (tagMatches) {
      findings.push({ rule: this.name, category: this.category, severity: 'critical', location, snippet: tagMatches[0], description: `Dangerous YAML tag detected: ${tagMatches.join(', ')}. These can trigger code execution in unsafe YAML parsers.` });
    }

    const lines = text.split('\n');
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0 && line.length - colonIdx > MAX_VALUE_LENGTH) {
        findings.push({ rule: this.name, category: this.category, severity: 'medium', location, snippet: line.slice(0, 80) + '...', description: `Extremely long YAML value (${line.length - colonIdx} chars). May indicate injection or resource exhaustion attempt.` });
      }
    }

    const anchorMatches = text.match(ANCHOR_RE);
    if (anchorMatches && anchorMatches.length > 8) {
      findings.push({ rule: this.name, category: this.category, severity: 'high', location, snippet: text.slice(0, 100), description: `Excessive YAML anchor references (${anchorMatches.length}). May indicate a "billion laughs" style amplification attack.` });
    }

    return findings;
  }
}
