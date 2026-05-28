'use client';

import React, { useState } from 'react';
import type { LineLocation } from '@/lib/openlr/types';
import { haversineMeters } from '@/lib/openlr/encode';

interface OpenLRPanelProps {
  b64: string;
  loc: LineLocation;
}

const OpenLRPanel: React.FC<OpenLRPanelProps> = ({ b64, loc }) => {
  const [copied, setCopied] = useState(false);

  const first = loc.lrps[0];
  const last = loc.lrps[loc.lrps.length - 1];

  const totalDist = loc.lrps.slice(0, -1).reduce(
    (sum, lrp) => sum + (lrp.distanceToNext ?? 0),
    0,
  );

  const directDist = haversineMeters(first.lon, first.lat, last.lon, last.lat);
  const displayDist = totalDist > 0 ? totalDist : directDist;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(b64);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="border border-gray-800 rounded p-3 bg-gray-900 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400">
          OpenLR reference
        </span>
        <button
          type="button"
          onClick={copy}
          className="text-[10px] font-mono text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-1.5 py-0.5"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      <pre className="font-mono text-[10px] text-gray-300 break-all whitespace-pre-wrap leading-relaxed bg-gray-950 rounded p-2">
        {b64}
      </pre>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
        <span className="text-gray-500">start</span>
        <span className="text-gray-300">
          {first.lon.toFixed(5)}, {first.lat.toFixed(5)}
        </span>
        <span className="text-gray-500">end</span>
        <span className="text-gray-300">
          {last.lon.toFixed(5)}, {last.lat.toFixed(5)}
        </span>
        <span className="text-gray-500">LRPs</span>
        <span className="text-gray-300">{loc.lrps.length}</span>
        <span className="text-gray-500">path length</span>
        <span className="text-gray-300">{displayDist.toFixed(0)} m</span>
        <span className="text-gray-500">FRC</span>
        <span className="text-gray-300">{first.frc} (class {first.frc})</span>
        <span className="text-gray-500">FOW</span>
        <span className="text-gray-300">{FOW_LABELS[first.fow] ?? String(first.fow)}</span>
      </div>

      <p className="text-[10px] text-gray-500 leading-relaxed border-t border-gray-800 pt-2">
        OpenLR (ISO 21219-5) encodes a road location as a compact base64 string
        that survives map version changes. HD-map vendors use these references so
        a consumer can apply a delta even when their road network differs from the
        producer&apos;s.
      </p>
    </div>
  );
};

const FOW_LABELS: Record<number, string> = {
  0: 'Undefined',
  1: 'Motorway',
  2: 'Multi-carriageway',
  3: 'Single carriageway',
  4: 'Roundabout',
  5: 'Traffiquare',
  6: 'Slip road',
  7: 'Other',
};

export default OpenLRPanel;
