"use client";

import type { TileTagRollup, Distribution } from "@/lib/osm/tag-rollup";

interface Props {
  rollup: TileTagRollup;
  sourceLabel: string;
}

export default function TileSignals({ rollup, sourceLabel }: Props) {
  const { lanes, maxspeed, oneway_pct, oneway_present, signals, way_count } = rollup;
  return (
    <div className="rounded border border-gray-800 bg-gray-900/40 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Tile tag signals
        </div>
        <span className="rounded border border-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
          {sourceLabel}
        </span>
      </div>

      <div className="mb-3 flex items-baseline gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-gray-500">ways</span>
        <span className="font-mono text-xs text-gray-200">{way_count}</span>
      </div>

      <DistRow label="lanes" dist={lanes} unit="" fmt={(n) => Math.round(n).toString()} />
      <DistRow
        label="maxspeed"
        dist={maxspeed}
        unit=" mph"
        fmt={(n) => Math.round(n).toString()}
      />

      <div className="mt-2 mb-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-gray-400">oneway</span>
          <span className="font-mono text-gray-300">
            {oneway_pct == null ? "no tag" : `${(oneway_pct * 100).toFixed(0)}%`}
            <span className="ml-1 text-gray-600">({oneway_present})</span>
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-gray-800">
          <div
            className="h-full bg-indigo-400/70"
            style={{ width: `${(oneway_pct ?? 0) * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Control nodes
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-[11px]">
          <NodeStat label="signals" value={signals.traffic_signals} />
          <NodeStat label="stops" value={signals.stop} />
          <NodeStat label="give-way" value={signals.give_way} />
        </div>
      </div>
    </div>
  );
}

function NodeStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-950/60 px-1.5 py-1">
      <div className="text-[9px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="font-mono text-xs text-gray-200">{value}</div>
    </div>
  );
}

function DistRow({
  label,
  dist,
  unit,
  fmt,
}: {
  label: string;
  dist: Distribution;
  unit: string;
  fmt: (n: number) => string;
}) {
  const total = dist.present + dist.missing;
  const coverage = total === 0 ? 0 : dist.present / total;
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-gray-400">{label}</span>
        {dist.present === 0 ? (
          <span className="font-mono text-gray-500">
            no tag ({dist.missing} missing)
          </span>
        ) : (
          <span className="font-mono text-gray-300">
            p50 {fmt(dist.p50 ?? 0)}
            {unit}
            <span className="ml-1 text-gray-600">
              ({fmt(dist.p10 ?? 0)} – {fmt(dist.p90 ?? 0)})
            </span>
          </span>
        )}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-gray-800">
        <div
          className="h-full bg-gray-400"
          style={{ width: `${coverage * 100}%` }}
        />
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[10px] text-gray-600">
        <span>coverage</span>
        <span className="font-mono">
          {(coverage * 100).toFixed(0)}% ({dist.present}/{total})
        </span>
      </div>
    </div>
  );
}
