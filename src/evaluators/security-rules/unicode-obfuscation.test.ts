import { describe, it, expect } from 'vitest';
import { UnicodeObfuscationRule } from './unicode-obfuscation.js';
import { YamlAnomalyRule } from './yaml-anomaly.js';

describe('UnicodeObfuscationRule', () => {
  const rule = new UnicodeObfuscationRule();

  it('detects zero-width characters', () => {
    const text = 'normal\u200Btext\u200Cwith\u200Dzero-width';
    const findings = rule.scan(text, 'skill.md');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].category).toBe('unicode-obfuscation');
  });

  it('detects homoglyph attacks', () => {
    const text = 'const \u0440 = require("fs")';
    const findings = rule.scan(text, 'skill.md');
    expect(findings.length).toBeGreaterThan(0);
  });

  it('detects bidi override characters', () => {
    const text = 'safe\u202Eesrever\u202C text';
    const findings = rule.scan(text, 'skill.md');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe('critical');
  });

  it('passes clean text', () => {
    expect(rule.scan('This is perfectly normal ASCII text.', 'skill.md')).toHaveLength(0);
  });
});

describe('YamlAnomalyRule', () => {
  const rule = new YamlAnomalyRule();

  it('detects extremely long single values', () => {
    const text = 'description: ' + 'A'.repeat(10001);
    const findings = rule.scan(text, 'eval.yaml');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].category).toBe('yaml-anomaly');
  });

  it('detects suspicious YAML tags', () => {
    const text = 'value: !!python/object:os.system ["rm -rf /"]';
    const findings = rule.scan(text, 'eval.yaml');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe('critical');
  });

  it('detects anchor bomb patterns', () => {
    const text = 'a: &anchor\n  x: 1\n' + Array.from({length: 10}, (_, i) => `v${i}: *anchor`).join('\n');
    const findings = rule.scan(text, 'eval.yaml');
    expect(findings.length).toBeGreaterThan(0);
  });

  it('passes clean YAML', () => {
    expect(rule.scan('name: test\ndescription: A normal skill', 'eval.yaml')).toHaveLength(0);
  });
});
