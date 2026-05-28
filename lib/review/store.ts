import { applyTransition } from './state';
import {
  type Assignee,
  type AuditEntry,
  type ReviewState,
  type ReviewStatus,
  type ReviewStoreData,
  DEFAULT_REVIEW_STATE,
} from './types';

export const STORAGE_KEY = 'avmap.review.v1';

function emptyStore(): ReviewStoreData {
  return { states: {}, audit: [] };
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadReviewState(): ReviewStoreData {
  if (!hasStorage()) return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'states' in parsed &&
      'audit' in parsed
    ) {
      const p = parsed as { states: unknown; audit: unknown };
      const statesOk =
        typeof p.states === 'object' && p.states !== null && !Array.isArray(p.states);
      const auditOk = Array.isArray(p.audit);
      if (!statesOk || !auditOk) return emptyStore();
      return {
        states: p.states as ReviewStoreData['states'],
        audit: p.audit as ReviewStoreData['audit'],
      };
    }
    return emptyStore();
  } catch {
    return emptyStore();
  }
}

export function persistReviewState(data: ReviewStoreData): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota or serialization failures are non-fatal in this prototype.
  }
}

export function getEditState(
  data: ReviewStoreData,
  editId: string,
): ReviewState {
  return data.states[editId] ?? DEFAULT_REVIEW_STATE;
}

export function appendAudit(
  data: ReviewStoreData,
  entry: AuditEntry,
): ReviewStoreData {
  return {
    states: data.states,
    audit: [...data.audit, entry],
  };
}

interface TransitionInput {
  editId: string;
  to: ReviewStatus;
  actor: string;
  comment?: string;
  now?: () => string;
}

export function transitionEdit(
  data: ReviewStoreData,
  input: TransitionInput,
): ReviewStoreData {
  const current = getEditState(data, input.editId);
  const next = applyTransition(current.status, input.to);
  if (next === current.status) return data;
  const ts = (input.now ?? (() => new Date().toISOString()))();
  const audit: AuditEntry = {
    ts,
    actor: input.actor,
    action: 'transition',
    edit_id: input.editId,
    from: current.status,
    to: next,
    comment: input.comment,
  };
  return {
    states: {
      ...data.states,
      [input.editId]: { ...current, status: next },
    },
    audit: [...data.audit, audit],
  };
}

interface AssignInput {
  editId: string;
  assignee: Assignee;
  actor: string;
  now?: () => string;
}

export function assignEdit(
  data: ReviewStoreData,
  input: AssignInput,
): ReviewStoreData {
  const current = getEditState(data, input.editId);
  const ts = (input.now ?? (() => new Date().toISOString()))();
  const audit: AuditEntry = {
    ts,
    actor: input.actor,
    action: 'assign',
    edit_id: input.editId,
    assignee: input.assignee,
  };
  return {
    states: {
      ...data.states,
      [input.editId]: { ...current, assignee: input.assignee },
    },
    audit: [...data.audit, audit],
  };
}

export function updateState(
  data: ReviewStoreData,
  editId: string,
  patch: Partial<ReviewState>,
): ReviewStoreData {
  const current = getEditState(data, editId);
  return {
    states: { ...data.states, [editId]: { ...current, ...patch } },
    audit: data.audit,
  };
}
