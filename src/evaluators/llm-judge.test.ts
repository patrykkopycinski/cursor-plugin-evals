import { describe, it, expect } from 'vitest';
import { ContentFilterError, isContentFilterError, handleJudgeError } from './llm-judge.js';

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

describe('handleJudgeError', () => {
  it('returns skipped result for ContentFilterError', () => {
    const err = new ContentFilterError('content policy violation');
    const result = handleJudgeError('test-evaluator', err);
    expect(result.evaluator).toBe('test-evaluator');
    expect(result.score).toBe(0);
    expect(result.pass).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.label).toBe('content_filtered');
    expect(result.explanation).toContain('content policy');
  });

  it('returns skipped result for errors with content filter pattern in message', () => {
    const err = new Error('ContentPolicyViolation: request blocked');
    const result = handleJudgeError('correctness', err);
    expect(result.pass).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.label).toBe('content_filtered');
  });

  it('returns error result for regular Error', () => {
    const err = new Error('network timeout');
    const result = handleJudgeError('my-eval', err);
    expect(result.evaluator).toBe('my-eval');
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.skipped).toBeUndefined();
    expect(result.label).toBe('error');
    expect(result.explanation).toContain('network timeout');
  });

  it('returns error result for string error', () => {
    const result = handleJudgeError('my-eval', 'something broke');
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.label).toBe('error');
    expect(result.explanation).toContain('something broke');
  });

  it('returns skipped result for string matching content filter pattern', () => {
    const result = handleJudgeError('my-eval', 'content_filter triggered');
    expect(result.pass).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.label).toBe('content_filtered');
  });

  it('truncates long error messages in the explanation', () => {
    const longMsg = 'content policy violation ' + 'x'.repeat(500);
    const err = new ContentFilterError(longMsg);
    const result = handleJudgeError('test', err);
    expect(result.explanation.length).toBeLessThan(longMsg.length + 100);
  });
});
