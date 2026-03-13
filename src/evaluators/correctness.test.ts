import { describe, it, expect } from 'vitest';
import {
  scoreClaimsWeighted,
  LABEL_FLOORS,
  type ClaimVerdict,
} from './correctness.js';

describe('scoreClaimsWeighted', () => {
  it('returns label floor when no claims are provided', () => {
    expect(scoreClaimsWeighted([], 'CORRECT')).toBe(LABEL_FLOORS['CORRECT']);
    expect(scoreClaimsWeighted([], 'INCORRECT')).toBe(LABEL_FLOORS['INCORRECT']);
  });

  it('scores all-supported core claims as 1.0', () => {
    const claims: ClaimVerdict[] = [
      { claim: 'A', centrality: 'core', verdict: 'supported', explanation: '' },
      { claim: 'B', centrality: 'core', verdict: 'supported', explanation: '' },
    ];
    const score = scoreClaimsWeighted(claims, 'CORRECT');
    expect(score).toBe(1.0);
  });

  it('gives lower score for contradicted core claims', () => {
    const claims: ClaimVerdict[] = [
      { claim: 'A', centrality: 'core', verdict: 'contradicted', explanation: '' },
    ];
    const score = scoreClaimsWeighted(claims, 'WRONG');
    expect(score).toBe(LABEL_FLOORS['WRONG']);
  });

  it('weights core claims higher than peripheral', () => {
    const coreClaim: ClaimVerdict = {
      claim: 'core',
      centrality: 'core',
      verdict: 'supported',
      explanation: '',
    };
    const peripheralClaim: ClaimVerdict = {
      claim: 'peripheral',
      centrality: 'peripheral',
      verdict: 'not_addressed',
      explanation: '',
    };

    const score = scoreClaimsWeighted([coreClaim, peripheralClaim], 'PARTIALLY_CORRECT');
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1.0);
  });

  it('enforces label floor even with low claim scores', () => {
    const claims: ClaimVerdict[] = [
      { claim: 'A', centrality: 'peripheral', verdict: 'not_addressed', explanation: '' },
    ];
    const score = scoreClaimsWeighted(claims, 'PARTIALLY_CORRECT');
    expect(score).toBeGreaterThanOrEqual(LABEL_FLOORS['PARTIALLY_CORRECT']);
  });

  it('accepts custom configuration', () => {
    const claims: ClaimVerdict[] = [
      { claim: 'A', centrality: 'core', verdict: 'supported', explanation: '' },
    ];
    const score = scoreClaimsWeighted(claims, 'CORRECT', {
      centralityWeights: { core: 2.0, supporting: 1.0, peripheral: 0.5 },
      verdictScores: { supported: 0.9, partially_supported: 0.4, not_addressed: 0.0, contradicted: -1.0 },
    });
    expect(score).toBe(0.9);
  });
});
