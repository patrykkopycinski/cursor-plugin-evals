import type { SecurityRule, SecurityFinding, RuleContext } from './types.js';

const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF\u00AD]/g;
const BIDI_RE = /[\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/g;
const HOMOGLYPH_RE = /[\u0400-\u04FF\u0370-\u03FF]/g;

export class UnicodeObfuscationRule implements SecurityRule {
  name = 'unicode-obfuscation';
  category = 'unicode-obfuscation';

  scan(text: string, location: string, _context?: RuleContext): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    const bidiMatches = text.match(BIDI_RE);
    if (bidiMatches) {
      findings.push({ rule: this.name, category: this.category, severity: 'critical', location, snippet: text.slice(0, 100), description: `Bidirectional override characters detected (${bidiMatches.length} occurrences). These can reverse text rendering to hide malicious content.` });
    }

    const zwMatches = text.match(ZERO_WIDTH_RE);
    if (zwMatches) {
      findings.push({ rule: this.name, category: this.category, severity: 'high', location, snippet: text.slice(0, 100), description: `Zero-width characters detected (${zwMatches.length} occurrences). These can hide content invisible to reviewers.` });
    }

    const latinRanges = text.match(/[a-zA-Z]{3,}/g);
    if (latinRanges && latinRanges.length > 0) {
      const homoglyphMatches = text.match(HOMOGLYPH_RE);
      if (homoglyphMatches) {
        findings.push({ rule: this.name, category: this.category, severity: 'high', location, snippet: text.slice(0, 100), description: `Potential homoglyph attack: Cyrillic/Greek characters (${homoglyphMatches.length}) mixed with Latin text.` });
      }
    }

    return findings;
  }
}
