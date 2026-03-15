import { describe, it, expect } from 'vitest';
import { evaluateDerivedMetrics, _evaluateFormulaForTesting as evaluateFormula } from './derived.js';

const makeSummary = (mean: number) => ({ mean, min: 0, max: 1, pass: 1, total: 1 });

describe('evaluateFormula', () => {
  const vars = { tool_selection: 0.9, correctness: 0.8, groundedness: 0.7, response_quality: 0.6 };

  it('evaluates a simple addition', () => {
    expect(evaluateFormula('1 + 2', {})).toBe(3);
  });

  it('evaluates multiplication and addition with precedence', () => {
    expect(evaluateFormula('2 + 3 * 4', {})).toBe(14);
  });

  it('evaluates a weighted sum formula', () => {
    const result = evaluateFormula(
      '0.4 * tool_selection + 0.3 * correctness + 0.2 * groundedness + 0.1 * response_quality',
      vars,
    );
    expect(result).toBeCloseTo(0.4 * 0.9 + 0.3 * 0.8 + 0.2 * 0.7 + 0.1 * 0.6);
  });

  it('evaluates subtraction', () => {
    expect(evaluateFormula('10 - 3 - 2', {})).toBe(5);
  });

  it('evaluates division', () => {
    expect(evaluateFormula('10 / 4', {})).toBe(2.5);
  });

  it('evaluates parenthesized expressions', () => {
    expect(evaluateFormula('(2 + 3) * 4', {})).toBe(20);
  });

  it('evaluates nested parentheses', () => {
    expect(evaluateFormula('((1 + 2) * (3 + 4))', {})).toBe(21);
  });

  it('evaluates unary minus', () => {
    expect(evaluateFormula('-5 + 10', {})).toBe(5);
  });

  it('evaluates min function', () => {
    expect(evaluateFormula('min(tool_selection, correctness, groundedness)', vars)).toBe(0.7);
  });

  it('evaluates max function', () => {
    expect(evaluateFormula('max(tool_selection, correctness, groundedness)', vars)).toBe(0.9);
  });

  it('evaluates avg function', () => {
    expect(evaluateFormula('avg(tool_selection, correctness)', vars)).toBeCloseTo(0.85);
  });

  it('evaluates functions with expressions as arguments', () => {
    expect(evaluateFormula('min(tool_selection * 2, 1.0)', vars)).toBe(1.0);
  });

  it('handles numeric literals with decimals', () => {
    expect(evaluateFormula('0.5 * 0.8', {})).toBeCloseTo(0.4);
  });

  it('throws on unknown variable', () => {
    expect(() => evaluateFormula('unknown_var + 1', {})).toThrow("Unknown evaluator 'unknown_var'");
  });

  it('throws on division by zero', () => {
    expect(() => evaluateFormula('1 / 0', {})).toThrow('Division by zero');
  });

  it('throws on empty formula', () => {
    expect(() => evaluateFormula('', {})).toThrow('Empty formula');
  });

  it('throws on unexpected character', () => {
    expect(() => evaluateFormula('1 @ 2', {})).toThrow("Unexpected character '@'");
  });

  it('throws on trailing tokens', () => {
    expect(() => evaluateFormula('1 2', {})).toThrow('Unexpected token');
  });

  it('supports variable names with hyphens', () => {
    expect(evaluateFormula('my-metric + 1', { 'my-metric': 0.5 })).toBeCloseTo(1.5);
  });
});

describe('evaluateDerivedMetrics', () => {
  const summary = {
    tool_selection: makeSummary(0.9),
    correctness: makeSummary(0.8),
    groundedness: makeSummary(0.7),
  };

  it('evaluates a weighted composite metric', () => {
    const results = evaluateDerivedMetrics(
      [{ name: 'composite', formula: '0.5 * tool_selection + 0.3 * correctness + 0.2 * groundedness', threshold: 0.7 }],
      summary,
    );
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('composite');
    expect(results[0].value).toBeCloseTo(0.5 * 0.9 + 0.3 * 0.8 + 0.2 * 0.7);
    expect(results[0].pass).toBe(true);
  });

  it('marks metric as failed when below threshold', () => {
    const results = evaluateDerivedMetrics(
      [{ name: 'high_bar', formula: 'correctness', threshold: 0.95 }],
      summary,
    );
    expect(results[0].pass).toBe(false);
    expect(results[0].value).toBeCloseTo(0.8);
  });

  it('passes when no threshold is set', () => {
    const results = evaluateDerivedMetrics(
      [{ name: 'info_only', formula: 'tool_selection + correctness' }],
      summary,
    );
    expect(results[0].pass).toBe(true);
    expect(results[0].value).toBeCloseTo(1.7);
  });

  it('returns error for unknown evaluator reference', () => {
    const results = evaluateDerivedMetrics(
      [{ name: 'broken', formula: 'nonexistent * 2', threshold: 0.5 }],
      summary,
    );
    expect(results[0].pass).toBe(false);
    expect(results[0].value).toBe(0);
    expect(results[0].error).toContain('nonexistent');
  });

  it('evaluates multiple metrics independently', () => {
    const results = evaluateDerivedMetrics(
      [
        { name: 'a', formula: 'tool_selection', threshold: 0.8 },
        { name: 'b', formula: 'groundedness', threshold: 0.8 },
      ],
      summary,
    );
    expect(results).toHaveLength(2);
    expect(results[0].pass).toBe(true);
    expect(results[1].pass).toBe(false);
  });

  it('handles min/max/avg across evaluators', () => {
    const results = evaluateDerivedMetrics(
      [{ name: 'worst', formula: 'min(tool_selection, correctness, groundedness)' }],
      summary,
    );
    expect(results[0].value).toBeCloseTo(0.7);
  });
});
