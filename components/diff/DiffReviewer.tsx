'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { DIFFS, DiffStatus } from '@/lib/diffs';
import DiffMapPane, { DiffMapRef } from './DiffMapPane';
import DiffListItem from './DiffListItem';
import { FeatureCollection } from 'geojson';

const DiffReviewer: React.FC = () => {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const [diffStates, setDiffStates] = useState<Record<string, DiffStatus>>({});
  
  const mapV1Ref = useRef<DiffMapRef>(null);
  const mapV2Ref = useRef<DiffMapRef>(null);
  const isSyncing = useRef(false);

  useEffect(() => {
    fetch('/data/mv.geojson')
      .then(res => res.json())
      .then(data => setGeojson(data));
  }, []);

  const syncMaps = (source: 'v1' | 'v2') => {
    if (isSyncing.current) return;
    
    const sourceMap = (source === 'v1' ? mapV1Ref : mapV2Ref).current?.getMap();
    const targetMap = (source === 'v1' ? mapV2Ref : mapV1Ref).current?.getMap();

    if (!sourceMap || !targetMap) return;

    isSyncing.current = true;
    targetMap.jumpTo({
      center: sourceMap.getCenter(),
      zoom: sourceMap.getZoom(),
      bearing: sourceMap.getBearing(),
      pitch: sourceMap.getPitch(),
    });
    
    // We need to reset isSyncing after the jumpTo has processed its own move events.
    // In MapLibre, jumpTo is synchronous for triggering events.
    isSyncing.current = false;
  };

  const handleApprove = (id: string) => {
    setDiffStates(prev => ({ ...prev, [id]: 'approved' }));
  };

  const handleReject = (id: string) => {
    setDiffStates(prev => ({ ...prev, [id]: 'rejected' }));
  };

  const handleUndo = (id: string) => {
    setDiffStates(prev => ({ ...prev, [id]: 'pending' }));
  };

  if (!geojson) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center text-gray-400 font-mono text-sm">
        Loading road network...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Top Bar */}
      <header className="h-[48px] border-b border-gray-800 flex items-center justify-between px-4 shrink-0 bg-gray-950 z-10">
        <div className="font-medium text-gray-200">AV Map Quality Console</div>
        <nav className="flex gap-6 text-sm">
          <Link href="/" className="text-gray-500 hover:text-gray-300 transition-colors">Triage</Link>
          <Link href="/diff" className="text-indigo-400 font-medium">Diff</Link>
          <Link href="/lanelet" className="text-gray-500 hover:text-gray-300 transition-colors">Lanelet2</Link>
        </nav>
      </header>

      {/* Impact Strip */}
      <div className="h-[40px] bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-4 shrink-0 z-10">
        <div className="flex items-center gap-4 text-sm font-mono text-gray-400 uppercase tracking-wider">
          <span>47 routes affected</span>
          <span className="text-gray-700">·</span>
          <span>12 simulated rides failed</span>
          <span className="text-gray-700">·</span>
          <span className="text-red-400">blocker: 1</span>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex flex-1 min-h-0">
        {/* Maps Section */}
        <div className="flex flex-1 min-w-0 border-r border-gray-800">
          <div className="flex-1 min-w-0 relative">
            <DiffMapPane
              ref={mapV1Ref}
              versionLabel="v2024.11.03 (baseline)"
              geojson={geojson}
              diffs={DIFFS}
              diffStates={diffStates}
              isV2={false}
              onMove={() => syncMaps('v1')}
            />
          </div>
          <div className="flex-1 min-w-0 relative border-l border-gray-800">
            <DiffMapPane
              ref={mapV2Ref}
              versionLabel="v2024.12.18 (candidate)"
              geojson={geojson}
              diffs={DIFFS}
              diffStates={diffStates}
              isV2={true}
              onMove={() => syncMaps('v2')}
            />
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-[360px] flex flex-col bg-gray-950 shrink-0 overflow-hidden">
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
              Pending diffs
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-800">
            {DIFFS.map(diff => (
              <DiffListItem
                key={diff.id}
                diff={diff}
                status={diffStates[diff.id] || 'pending'}
                onApprove={handleApprove}
                onReject={handleReject}
                onUndo={handleUndo}
              />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default DiffReviewer;
