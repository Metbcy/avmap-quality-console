'use client';

import React from 'react';
import { MapDiff, DiffStatus } from '@/lib/diffs';

interface DiffListItemProps {
  diff: MapDiff;
  status: DiffStatus;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onUndo: (id: string) => void;
}

const DiffListItem: React.FC<DiffListItemProps> = ({
  diff,
  status,
  onApprove,
  onReject,
  onUndo,
}) => {
  const getIconColor = () => {
    switch (diff.kind) {
      case 'new_lane': return 'bg-red-500';
      case 'moved_crosswalk': return 'bg-yellow-500';
      case 'removed_stop_sign': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'approved':
        return <span className="text-[10px] text-emerald-400 font-medium">approved</span>;
      case 'rejected':
        return <span className="text-[10px] text-gray-500 font-medium line-through">rejected</span>;
      default:
        return <span className="text-[10px] text-gray-500 font-medium">pending</span>;
    }
  };

  const formatCoords = () => {
    const geo = diff.geometryV2 || diff.geometryV1;
    if (!geo) return 'N/A';
    if (Array.isArray(geo[0])) {
      // LineString
      const first = geo[0] as number[];
      return `${first[0].toFixed(4)}, ${first[1].toFixed(4)}...`;
    }
    // Point
    const pt = geo as number[];
    return `${pt[0].toFixed(4)}, ${pt[1].toFixed(4)}`;
  };

  return (
    <div className="border border-gray-800 rounded-md p-3 bg-gray-900 flex flex-col gap-2">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-sm ${getIconColor()}`} />
          <span className="text-sm font-medium text-gray-200 uppercase tracking-tight">
            {diff.kind.replace('_', ' ')}
          </span>
        </div>
        {getStatusBadge()}
      </div>

      <p className="text-xs text-gray-400 leading-tight">
        {diff.description}
      </p>

      <div className="text-[10px] font-mono text-gray-500">
        {formatCoords()}
      </div>

      <div className="flex gap-2 mt-1">
        {status === 'pending' ? (
          <>
            <button
              onClick={() => onApprove(diff.id)}
              className="bg-emerald-500 text-gray-950 px-2 py-1 text-xs rounded font-medium hover:bg-emerald-400 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => onReject(diff.id)}
              className="bg-gray-700 text-gray-200 px-2 py-1 text-xs rounded font-medium hover:bg-gray-600 transition-colors"
            >
              Reject
            </button>
          </>
        ) : (
          <button
            onClick={() => onUndo(diff.id)}
            className="text-indigo-400 text-xs hover:underline"
          >
            Undo action
          </button>
        )}
      </div>

      <textarea
        rows={2}
        className="bg-gray-950 border border-gray-800 text-gray-200 text-xs rounded p-2 w-full mt-1 focus:outline-none focus:border-indigo-500"
        placeholder="leave a comment…"
      />
    </div>
  );
};

export default DiffListItem;
