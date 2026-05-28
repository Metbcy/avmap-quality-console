export type ReviewStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'needs_info';

export type Assignee = 'alice' | 'ben' | 'chen' | null;

export const ASSIGNEES: Exclude<Assignee, null>[] = ['alice', 'ben', 'chen'];

export interface ReviewState {
  status: ReviewStatus;
  assignee: Assignee;
}

export type AuditAction = 'transition' | 'assign' | 'comment';

export interface AuditEntry {
  ts: string;
  actor: string;
  action: AuditAction;
  edit_id: string;
  from?: ReviewStatus;
  to?: ReviewStatus;
  assignee?: Assignee;
  comment?: string;
}

export interface ReviewStoreData {
  states: Record<string, ReviewState>;
  audit: AuditEntry[];
}

export const DEFAULT_REVIEW_STATE: ReviewState = {
  status: 'pending',
  assignee: null,
};
