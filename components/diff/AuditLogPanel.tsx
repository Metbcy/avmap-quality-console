'use client';

import React from 'react';
import type { AuditEntry } from '@/lib/review/types';

interface AuditLogPanelProps {
  audit: AuditEntry[];
  onClear?: () => void;
}

function describe(entry: AuditEntry): string {
  if (entry.action === 'transition') {
    return `${entry.from ?? '?'} -> ${entry.to ?? '?'}`;
  }
  if (entry.action === 'assign') {
    return `assigned to ${entry.assignee ?? 'Unassigned'}`;
  }
  return 'comment';
}

const AuditLogPanel: React.FC<AuditLogPanelProps> = ({ audit, onClear }) => {
  const reversed = [...audit].reverse();
  return (
    <div className="flex flex-col h-full bg-gray-950 border-l border-gray-800">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 h-[40px] shrink-0">
        <h3 className="text-xs font-medium text-gray-300 uppercase tracking-wider">
          Audit log
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-gray-500">
            {audit.length} entr{audit.length === 1 ? 'y' : 'ies'}
          </span>
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] font-mono text-gray-500 hover:text-gray-300"
            >
              clear
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {reversed.length === 0 ? (
          <p className="text-[11px] text-gray-600 italic">
            No actions yet. Claim an edit to begin.
          </p>
        ) : (
          reversed.map((entry, idx) => (
            <div
              key={`${entry.ts}-${idx}`}
              className="border border-gray-800 rounded p-2 bg-gray-900"
            >
              <div className="flex justify-between text-[10px] font-mono text-gray-500">
                <span>{entry.actor}</span>
                <span>{new Date(entry.ts).toLocaleTimeString()}</span>
              </div>
              <div className="text-[11px] text-gray-200 mt-1">
                <span className="font-mono text-indigo-300">
                  {entry.edit_id}
                </span>{' '}
                {describe(entry)}
              </div>
              {entry.comment ? (
                <div className="text-[11px] text-gray-400 italic mt-1">
                  &ldquo;{entry.comment}&rdquo;
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AuditLogPanel;
