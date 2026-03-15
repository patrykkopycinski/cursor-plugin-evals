import { describe, it, expect } from 'vitest';
import { ContentFilterError, isContentFilterError } from './llm-judge.js';

describe('ContentFilterError', () => {
  it('is detected by isContentFilterError', () => {
    const err = new ContentFilterError('blocked');
    expect(isContentFilterError(err)).toBe(true);
  });

  it('has correct name property', () => {
    const err = new ContentFilterError('test');
    expect(err.name).toBe('ContentFilterError');
  });
});

describe('isContentFilterError', () => {
  it('detects content policy violation in error message', () => {
    expect(isContentFilterError(new Error('content policy violation occurred'))).toBe(true);
    expect(isContentFilterError(new Error('ContentPolicyViolation: blocked'))).toBe(true);
    expect(isContentFilterError(new Error('content_filter triggered'))).toBe(true);
    expect(isContentFilterError(new Error('content management block'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isContentFilterError(new Error('network timeout'))).toBe(false);
    expect(isContentFilterError(new Error('rate limit exceeded'))).toBe(false);
    expect(isContentFilterError(new Error('invalid model'))).toBe(false);
  });

  it('handles string errors', () => {
    expect(isContentFilterError('content_filter blocked')).toBe(true);
    expect(isContentFilterError('some other error')).toBe(false);
  });
});
