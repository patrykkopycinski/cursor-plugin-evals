import { describe, it, expect } from 'vitest';
import { computeReadability } from './readability.js';

describe('computeReadability', () => {
  it('scores simple text as highly readable', () => {
    const result = computeReadability('Use this skill to write queries. It helps you find data. Simple and fast.');
    expect(result.fleschKincaid).toBeLessThan(8);
    expect(result.grade).toMatch(/[AB]/);
  });

  it('scores complex text as less readable', () => {
    const result = computeReadability('The implementation necessitates comprehensive understanding of the architectural paradigm underlying the distributed computational infrastructure.');
    expect(result.fleschKincaid).toBeGreaterThan(10);
  });

  it('computes sentence and word counts', () => {
    const result = computeReadability('First sentence. Second sentence. Third sentence.');
    expect(result.sentences).toBe(3);
    expect(result.words).toBe(6);
  });

  it('handles empty text', () => {
    const result = computeReadability('');
    expect(result.words).toBe(0);
    expect(result.grade).toBe('F');
  });

  it('includes section structure analysis', () => {
    const md = '## Overview\nIntro text.\n## Usage\nHow to use.\n## Examples\nCode here.';
    const result = computeReadability(md);
    expect(result.sectionCount).toBe(3);
    expect(result.hasExamples).toBe(true);
  });

  it('detects prerequisites', () => {
    const text = 'Before you start, ensure you have the prerequisites installed. Setup your environment.';
    const result = computeReadability(text);
    expect(result.hasPrerequisites).toBe(true);
  });
});
