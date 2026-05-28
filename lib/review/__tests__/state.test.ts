import { describe, it, expect } from 'vitest';
import {
  applyTransition,
  canTransition,
  isTerminal,
  legalNextStates,
} from '../state';

describe('review state machine', () => {
  it('allows pending -> in_review', () => {
    expect(canTransition('pending', 'in_review')).toBe(true);
    expect(applyTransition('pending', 'in_review')).toBe('in_review');
  });

  it('allows in_review -> approved/rejected/needs_info', () => {
    expect(canTransition('in_review', 'approved')).toBe(true);
    expect(canTransition('in_review', 'rejected')).toBe(true);
    expect(canTransition('in_review', 'needs_info')).toBe(true);
  });

  it('allows needs_info -> in_review', () => {
    expect(canTransition('needs_info', 'in_review')).toBe(true);
  });

  it('rejects pending -> approved (must claim first)', () => {
    expect(canTransition('pending', 'approved')).toBe(false);
    expect(() => applyTransition('pending', 'approved')).toThrow();
  });

  it('rejects in_review -> pending', () => {
    expect(canTransition('in_review', 'pending')).toBe(false);
    expect(() => applyTransition('in_review', 'pending')).toThrow();
  });

  it('treats approved and rejected as terminal', () => {
    expect(isTerminal('approved')).toBe(true);
    expect(isTerminal('rejected')).toBe(true);
    expect(legalNextStates('approved')).toEqual([]);
    expect(legalNextStates('rejected')).toEqual([]);
    expect(() => applyTransition('approved', 'in_review')).toThrow();
  });

  it('legalNextStates returns the documented transitions', () => {
    expect(legalNextStates('pending')).toEqual(['in_review']);
    expect(legalNextStates('in_review')).toEqual([
      'approved',
      'rejected',
      'needs_info',
    ]);
    expect(legalNextStates('needs_info')).toEqual(['in_review']);
  });
});
