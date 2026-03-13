import { describe, it, expect } from 'vitest';
import {
  generateBadgeSvg,
  generateScoreBadge,
  generatePassRateBadge,
  generateConformanceBadge,
  generateSecurityBadge,
  generateResilienceBadge,
  gradeColor,
} from './generator.js';

describe('generateBadgeSvg', () => {
  it('generates valid SVG', () => {
    const svg = generateBadgeSvg({ label: 'tests', value: '42', color: 'green' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('tests');
    expect(svg).toContain('42');
  });

  it('uses flat style with border radius', () => {
    const svg = generateBadgeSvg({ label: 'a', value: 'b', color: 'blue', style: 'flat' });
    expect(svg).toContain('rx="3"');
  });

  it('uses flat-square style with no radius', () => {
    const svg = generateBadgeSvg({ label: 'a', value: 'b', color: 'blue', style: 'flat-square' });
    expect(svg).toContain('rx="0"');
  });

  it('resolves named colors', () => {
    const svg = generateBadgeSvg({ label: 'a', value: 'b', color: 'red' });
    expect(svg).toContain('#F44336');
  });

  it('passes hex colors through', () => {
    const svg = generateBadgeSvg({ label: 'a', value: 'b', color: '#ABC123' });
    expect(svg).toContain('#ABC123');
  });

  it('escapes XML entities', () => {
    const svg = generateBadgeSvg({ label: 'a<b', value: 'c&d', color: 'green' });
    expect(svg).toContain('a&lt;b');
    expect(svg).toContain('c&amp;d');
  });
});

describe('gradeColor', () => {
  it('maps A to brightgreen', () => expect(gradeColor('A')).toBe('brightgreen'));
  it('maps B to green', () => expect(gradeColor('B')).toBe('green'));
  it('maps C to yellow', () => expect(gradeColor('C')).toBe('yellow'));
  it('maps D to orange', () => expect(gradeColor('D')).toBe('orange'));
  it('maps F to red', () => expect(gradeColor('F')).toBe('red'));
  it('maps unknown to gray', () => expect(gradeColor('?')).toBe('gray'));
});

describe('specialized badges', () => {
  it('generates score badge', () => {
    const svg = generateScoreBadge(85, 'B');
    expect(svg).toContain('eval score');
    expect(svg).toContain('B (85%)');
  });

  it('generates pass rate badge', () => {
    const svg = generatePassRateBadge(0.95);
    expect(svg).toContain('pass rate');
    expect(svg).toContain('95%');
  });

  it('generates conformance badge', () => {
    const svg = generateConformanceBadge(1, 0.98);
    expect(svg).toContain('MCP conformance');
    expect(svg).toContain('Tier 1');
  });

  it('generates security badge', () => {
    const svg = generateSecurityBadge('A');
    expect(svg).toContain('security');
    expect(svg).toContain('A');
  });

  it('generates resilience badge', () => {
    const svg = generateResilienceBadge(0.92);
    expect(svg).toContain('resilience');
    expect(svg).toContain('92%');
  });
});
