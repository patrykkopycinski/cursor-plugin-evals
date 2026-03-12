import { describe, it, expect } from 'vitest';
import { calculateCost, getPricingCatalog } from './index.js';

describe('calculateCost', () => {
  it('calculates cost for a known model (gpt-4o)', () => {
    const cost = calculateCost('gpt-4o', { input: 1000, output: 500 });
    expect(cost).not.toBeNull();
    expect(cost).toBeCloseTo((1000 / 1_000_000) * 2.5 + (500 / 1_000_000) * 10.0, 8);
  });

  it('accounts for cached tokens', () => {
    const cost = calculateCost('gpt-4o', { input: 1000, output: 500, cached: 400 });
    expect(cost).not.toBeNull();
    const inputCost = (600 / 1_000_000) * 2.5;
    const outputCost = (500 / 1_000_000) * 10.0;
    const cachedCost = (400 / 1_000_000) * 1.25;
    expect(cost).toBeCloseTo(inputCost + outputCost + cachedCost, 8);
  });

  it('falls back to input rate for cached when model has no cached pricing', () => {
    const cost = calculateCost('gpt-4-turbo', { input: 1000, output: 500, cached: 200 });
    expect(cost).not.toBeNull();
    const inputCost = (800 / 1_000_000) * 10.0;
    const outputCost = (500 / 1_000_000) * 30.0;
    const cachedCost = (200 / 1_000_000) * 10.0;
    expect(cost).toBeCloseTo(inputCost + outputCost + cachedCost, 8);
  });

  it('returns null for unknown model', () => {
    const cost = calculateCost('totally-unknown-model-xyz', { input: 1000, output: 500 });
    expect(cost).toBeNull();
  });

  it('returns 0 for zero tokens', () => {
    const cost = calculateCost('gpt-4o', { input: 0, output: 0 });
    expect(cost).toBe(0);
  });

  it('handles case-insensitive / partial model matching', () => {
    const cost = calculateCost('gpt-4o-2024-08-06', { input: 1000, output: 500 });
    expect(cost).not.toBeNull();
  });

  it('calculates cost for claude model', () => {
    const cost = calculateCost('claude-sonnet-4-20250514', { input: 1000, output: 500 });
    expect(cost).not.toBeNull();
    expect(cost).toBeCloseTo((1000 / 1_000_000) * 3.0 + (500 / 1_000_000) * 15.0, 8);
  });

  it('handles all-cached scenario', () => {
    const cost = calculateCost('gpt-4o', { input: 1000, output: 0, cached: 1000 });
    expect(cost).not.toBeNull();
    expect(cost).toBeCloseTo((1000 / 1_000_000) * 1.25, 8);
  });
});

describe('getPricingCatalog', () => {
  it('returns a copy of the catalog', () => {
    const catalog1 = getPricingCatalog();
    const catalog2 = getPricingCatalog();
    expect(catalog1).toEqual(catalog2);
    expect(catalog1).not.toBe(catalog2);
  });

  it('contains expected model keys', () => {
    const catalog = getPricingCatalog();
    expect(catalog).toHaveProperty('gpt-4o');
    expect(catalog).toHaveProperty('gpt-4o-mini');
    expect(catalog).toHaveProperty('claude-sonnet-4-20250514');
    expect(catalog).toHaveProperty('gemini-2.5-pro');
  });

  it('each model has input and output pricing', () => {
    const catalog = getPricingCatalog();
    for (const [name, pricing] of Object.entries(catalog)) {
      expect(pricing.input, `${name} missing input pricing`).toBeGreaterThan(0);
      expect(pricing.output, `${name} missing output pricing`).toBeGreaterThan(0);
    }
  });
});
