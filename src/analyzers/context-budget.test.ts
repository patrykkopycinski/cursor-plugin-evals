import { describe, it, expect } from 'vitest';
import { analyzeContextBudget } from './context-budget.js';
import type { SkillComponent } from '../core/types.js';

function makeSkill(name: string, bodyLength: number): SkillComponent {
  return { name, description: `Skill ${name}`, path: `/skills/${name}`, body: 'x'.repeat(bodyLength) };
}

describe('analyzeContextBudget', () => {
  it('estimates tokens from skill body', () => {
    const report = analyzeContextBudget([makeSkill('small', 400)]);
    expect(report.skills[0].estimatedTokens).toBeCloseTo(100, -1);
    expect(report.skills[0].bloated).toBe(false);
  });

  it('flags bloated skills', () => {
    const report = analyzeContextBudget([makeSkill('huge', 8000)]);
    expect(report.skills[0].bloated).toBe(true);
  });

  it('computes total and remaining', () => {
    const report = analyzeContextBudget([makeSkill('a', 2000), makeSkill('b', 2000)], { contextWindow: 128000 });
    expect(report.totalEstimatedTokens).toBeGreaterThan(0);
    expect(report.remainingTokens).toBeLessThan(128000);
  });

  it('warns when over threshold', () => {
    const skills = Array.from({ length: 20 }, (_, i) => makeSkill(`s${i}`, 4000));
    const report = analyzeContextBudget(skills, { contextWindow: 8000, warningThreshold: 0.5 });
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('empty skills', () => {
    const report = analyzeContextBudget([]);
    expect(report.skills).toHaveLength(0);
    expect(report.totalEstimatedTokens).toBe(0);
  });
});
