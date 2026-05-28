import type { ReviewStatus } from './types';

const TRANSITIONS: Record<ReviewStatus, ReadonlyArray<ReviewStatus>> = {
  pending: ['in_review'],
  in_review: ['approved', 'rejected', 'needs_info'],
  needs_info: ['in_review'],
  approved: [],
  rejected: [],
};

export function legalNextStates(from: ReviewStatus): ReadonlyArray<ReviewStatus> {
  return TRANSITIONS[from];
}

export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(state: ReviewStatus): boolean {
  return TRANSITIONS[state].length === 0;
}

const IS_DEV =
  typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';

/**
 * Applies a state transition. Throws in development on illegal transitions,
 * no-ops in production (returns the original state unchanged).
 */
export function applyTransition(
  from: ReviewStatus,
  to: ReviewStatus,
): ReviewStatus {
  if (!canTransition(from, to)) {
    if (IS_DEV) {
      throw new Error(`Illegal review transition: ${from} -> ${to}`);
    }
    return from;
  }
  return to;
}
