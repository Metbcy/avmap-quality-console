'use client';

import React, { useState } from 'react';
import type { Edit, OsmNodeElement, OsmWayElement } from '@/lib/osc/types';
import {
  ASSIGNEES,
  type Assignee,
  type ReviewState,
  type ReviewStatus,
} from '@/lib/review/types';
import { legalNextStates, isTerminal } from '@/lib/review/state';
import RawXmlTab from './RawXmlTab';

interface EditCardProps {
  edit: Edit;
  state: ReviewState;
  isSelected: boolean;
  ageMinutes: number | null;
  onSelect: (id: string) => void;
  onTransition: (id: string, to: ReviewStatus, comment?: string) => void;
  onAssign: (id: string, assignee: Assignee) => void;
}

const ACTION_BADGE: Record<Edit['action'], string> = {
  create: 'bg-emerald-500/20 text-emerald-300 border-emerald-700',
  modify: 'bg-yellow-500/20 text-yellow-300 border-yellow-700',
  delete: 'bg-red-500/20 text-red-300 border-red-700',
};

const STATUS_BADGE: Record<ReviewStatus, string> = {
  pending: 'bg-gray-700 text-gray-200',
  in_review: 'bg-indigo-500/30 text-indigo-200 border border-indigo-600',
  approved: 'bg-emerald-500/30 text-emerald-200 border border-emerald-700',
  rejected: 'bg-gray-700 text-gray-400 line-through',
  needs_info: 'bg-amber-500/30 text-amber-200 border border-amber-600',
};

const ACTION_LABEL: Record<ReviewStatus, string> = {
  pending: 'Claim',
  in_review: '',
  approved: 'Approved',
  rejected: 'Rejected',
  needs_info: 'Awaiting info',
};

function describeTags(el: Edit['element']): string {
  const keys = Object.keys(el.tags);
  if (keys.length === 0) return 'no tags';
  return keys
    .slice(0, 4)
    .map((k) => `${k}=${el.tags[k]}`)
    .join(', ');
}

function summaryDetail(edit: Edit): string {
  const { element, action } = edit;
  if (element.type === 'node') {
    const n = element as OsmNodeElement;
    const coord =
      n.lat !== undefined && n.lon !== undefined
        ? ` @ ${n.lon.toFixed(5)}, ${n.lat.toFixed(5)}`
        : '';
    if (action === 'delete') return `Remove node${coord}`;
    return `${describeTags(element)}${coord}`;
  }
  if (element.type === 'way') {
    const w = element as OsmWayElement;
    return `${w.nds.length} nd refs · ${describeTags(element)}`;
  }
  return describeTags(element);
}

function slaTone(state: ReviewStatus, age: number | null): string {
  if (age === null) return 'text-gray-500 border-gray-700';
  if (state === 'in_review') {
    if (age > 15) return 'text-red-300 border-red-700 bg-red-500/10';
    if (age > 5) return 'text-yellow-300 border-yellow-700 bg-yellow-500/10';
  }
  return 'text-gray-400 border-gray-700';
}

const EditCard: React.FC<EditCardProps> = ({
  edit,
  state,
  isSelected,
  ageMinutes,
  onSelect,
  onTransition,
  onAssign,
}) => {
  const [tab, setTab] = useState<'summary' | 'raw'>('summary');
  const [comment, setComment] = useState('');
  const nextStates = legalNextStates(state.status);

  const fire = (to: ReviewStatus) => {
    onTransition(edit.id, to, comment.trim() || undefined);
    setComment('');
  };

  const ageLabel =
    ageMinutes === null ? '— min' : `${Math.max(0, Math.floor(ageMinutes))} min`;

  return (
    <div
      className={`border rounded-md p-3 flex flex-col gap-2 cursor-pointer transition-colors ${
        isSelected
          ? 'border-indigo-500 bg-gray-900'
          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
      }`}
      onClick={() => onSelect(edit.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase ${ACTION_BADGE[edit.action]}`}
          >
            {edit.action}
          </span>
          <span className="text-[11px] font-mono text-gray-400 truncate">
            {edit.element.type}/{edit.element.id}
          </span>
        </div>
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${STATUS_BADGE[state.status]}`}
        >
          {state.status.replace('_', ' ')}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-gray-500">{edit.id}</span>
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${slaTone(state.status, ageMinutes)}`}
        >
          age {ageLabel}
        </span>
      </div>

      <div className="flex border-b border-gray-800 text-[10px] font-mono uppercase tracking-wider">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTab('summary');
          }}
          className={`px-2 py-1 ${tab === 'summary' ? 'text-indigo-300 border-b border-indigo-500' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Summary
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTab('raw');
          }}
          className={`px-2 py-1 ${tab === 'raw' ? 'text-indigo-300 border-b border-indigo-500' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Raw
        </button>
      </div>

      {tab === 'summary' ? (
        <p className="text-xs text-gray-300 leading-snug">
          <span className="text-gray-200 font-medium">{edit.summary}.</span>{' '}
          <span className="text-gray-400">{summaryDetail(edit)}</span>
        </p>
      ) : (
        <RawXmlTab edit={edit} />
      )}

      <div
        className="flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <label className="text-[10px] font-mono text-gray-500">assignee</label>
        <select
          value={state.assignee ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onAssign(edit.id, v === '' ? null : (v as Assignee));
          }}
          className="bg-gray-950 border border-gray-800 text-xs text-gray-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
        >
          <option value="">Unassigned</option>
          {ASSIGNEES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {!isTerminal(state.status) ? (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          rows={2}
          placeholder="optional comment for state change"
          className="bg-gray-950 border border-gray-800 text-gray-200 text-xs rounded p-2 w-full focus:outline-none focus:border-indigo-500"
        />
      ) : null}

      <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        {nextStates.length === 0 ? (
          <span className="text-[10px] font-mono text-gray-500">
            {ACTION_LABEL[state.status]} (terminal)
          </span>
        ) : (
          nextStates.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => fire(s)}
              className={`text-[11px] px-2 py-1 rounded font-medium ${
                s === 'approved'
                  ? 'bg-emerald-500 text-gray-950 hover:bg-emerald-400'
                  : s === 'rejected'
                    ? 'bg-red-500 text-gray-950 hover:bg-red-400'
                    : s === 'needs_info'
                      ? 'bg-amber-500 text-gray-950 hover:bg-amber-400'
                      : 'bg-indigo-500 text-gray-950 hover:bg-indigo-400'
              }`}
            >
              {s === 'in_review' && state.status === 'pending'
                ? 'Claim'
                : s === 'in_review'
                  ? 'Resume review'
                  : s.replace('_', ' ')}
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default EditCard;
