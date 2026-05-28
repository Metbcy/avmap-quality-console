"use client";

import type { LaneletPolygonProperties } from "@/lib/lanelet2/toGeoJSON";

export interface LaneletStats {
  laneletCount: number;
  regulatoryElementCount: number;
  stopLineCount: number;
  trafficLightCount: number;
  bbox: [number, number, number, number];
}

interface LaneletSidebarProps {
  stats: LaneletStats;
  selected: LaneletPolygonProperties | null;
  onClear: () => void;
}

export default function LaneletSidebar({ stats, selected, onClear }: LaneletSidebarProps) {
  return (
    <aside className="flex w-80 shrink-0 flex-col gap-5 border-r border-gray-800 bg-gray-950 px-4 py-4 overflow-y-auto">
      <Section title="Summary">
        <ul className="space-y-1 text-xs text-gray-300">
          <li>
            <span className="text-gray-500">lanelets </span>
            <span className="font-mono text-indigo-300">{stats.laneletCount}</span>
          </li>
          <li>
            <span className="text-gray-500">regulatory elements </span>
            <span className="font-mono text-indigo-300">{stats.regulatoryElementCount}</span>
          </li>
          <li>
            <span className="text-gray-500">stop / ref lines </span>
            <span className="font-mono text-indigo-300">{stats.stopLineCount}</span>
          </li>
          <li>
            <span className="text-gray-500">traffic lights </span>
            <span className="font-mono text-indigo-300">{stats.trafficLightCount}</span>
          </li>
        </ul>
      </Section>

      <Section title="Bounding box">
        <div className="font-mono text-[11px] leading-snug text-gray-400">
          <div>min lon {stats.bbox[0].toFixed(6)}</div>
          <div>min lat {stats.bbox[1].toFixed(6)}</div>
          <div>max lon {stats.bbox[2].toFixed(6)}</div>
          <div>max lat {stats.bbox[3].toFixed(6)}</div>
        </div>
      </Section>

      <Section title="Legend">
        <ul className="space-y-1.5 text-xs text-gray-400">
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm border border-indigo-400 bg-indigo-500/30" />
            lanelet polygon
          </li>
          <li className="flex items-center gap-2">
            <span className="h-0.5 w-4 bg-gray-400" />
            lane boundary
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1 w-4 bg-red-500" />
            stop / ref line
          </li>
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border border-amber-900 bg-yellow-400" />
            traffic light
          </li>
        </ul>
      </Section>

      <Section title="Selected lanelet">
        {!selected ? (
          <div className="text-xs text-gray-500">Click a lanelet polygon on the map.</div>
        ) : (
          <div className="flex flex-col gap-2 text-xs">
            <div className="font-mono text-sm text-indigo-300">id {selected.lanelet_id}</div>
            <TagRow k="subtype" v={selected.subtype} />
            <TagRow k="location" v={selected.location} />
            <TagRow k="one_way" v={selected.one_way} />
            <TagRow k="speed_limit" v={selected.speed_limit} />
            <TagRow k="region" v={selected.region} />
            <button
              onClick={onClear}
              className="mt-1 self-start rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-gray-500"
            >
              Clear
            </button>
          </div>
        )}
      </Section>

      <div className="mt-auto text-[10px] leading-snug text-gray-500">
        Lanelet2 sample data: © FZI Forschungszentrum Informatik, BSD-3-Clause.
        Basemap © OpenStreetMap contributors © CARTO.
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function TagRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-gray-900 pb-1">
      <span className="text-[10px] uppercase tracking-widest text-gray-500">{k}</span>
      <span className="font-mono text-gray-200">{v === "" ? "—" : v}</span>
    </div>
  );
}
