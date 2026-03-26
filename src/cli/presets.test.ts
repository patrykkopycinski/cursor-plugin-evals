import { describe, it, expect } from 'vitest';
import { TRIAL_PRESETS, resolveRepeatFromPreset } from './presets.js';

describe('TRIAL_PRESETS', () => {
  it('exports preset map with correct values', () => {
    expect(TRIAL_PRESETS).toEqual({
      smoke: 5,
      reliable: 20,
      regression: 50,
    });
  });
});

describe('resolveRepeatFromPreset', () => {
  it('returns 5 for smoke', () => {
    expect(resolveRepeatFromPreset('smoke')).toBe(5);
  });

  it('returns 20 for reliable', () => {
    expect(resolveRepeatFromPreset('reliable')).toBe(20);
  });

  it('returns 50 for regression', () => {
    expect(resolveRepeatFromPreset('regression')).toBe(50);
  });

  it('returns undefined for undefined input', () => {
    expect(resolveRepeatFromPreset(undefined)).toBeUndefined();
  });
});
