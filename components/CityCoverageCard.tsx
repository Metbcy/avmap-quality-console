"use client";

import type { CoverageKPIs } from "@/lib/kpi";

interface Props {
  cityLabel: string;
  kpis?: CoverageKPIs;
  comingSoon?: boolean;
}

export default function CityCoverageCard({ cityLabel, kpis, comingSoon }: Props) {
  if (comingSoon || !kpis) {
    return (
      <div className="flex flex-col rounded-lg border border-dashed border-gray-800 bg-gray-900/20 p-6 opacity-50">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-400">{cityLabel}</h2>
          <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Coming soon
          </span>
        </div>
        <div className="flex-1" />
        <div className="h-1.5 w-full rounded-full bg-gray-800" />
      </div>
    );
  }

  const {
    pctReady,
    meanReadiness,
    flagsHigh,
    flagsMed,
    flagsLow,
    oldestDays,
    staleCount,
  } = kpis;

  const barColor = pctReady >= 75 ? "bg-emerald-500" : pctReady >= 50 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="flex flex-col rounded-lg border border-gray-800 bg-gray-900/40 p-6 transition-colors hover:border-gray-700">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-100">{cityLabel}</h2>
        <div className="flex flex-col items-end">
          <span className="text-2xl font-bold text-gray-100">{pctReady.toFixed(0)}%</span>
          <span className="text-[10px] uppercase tracking-widest text-gray-500">Ready</span>
        </div>
      </div>

      <div className="mb-8">
        <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
          <div
            className={`h-full ${barColor} transition-all duration-500`}
            style={{ width: `${pctReady}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-y-6">
        <Stat label="Mean readiness" value={meanReadiness.toFixed(2)} />
        <Stat
          label="Oldest tile"
          value={`${oldestDays}d`}
          sub={staleCount > 0 ? `${staleCount} stale` : "all fresh"}
        />
        <div className="col-span-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Validator flags
          </div>
          <div className="flex gap-4">
            <SeverityStat label="High" count={flagsHigh} color="text-red-400" />
            <SeverityStat label="Med" count={flagsMed} color="text-yellow-300" />
            <SeverityStat label="Low" count={flagsLow} color="text-green-300" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">{label}</div>
      <div className="font-mono text-lg text-gray-200">{value}</div>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </div>
  );
}

function SeverityStat({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase text-gray-500">{label}</span>
      <span className={`font-mono text-sm ${color}`}>{count}</span>
    </div>
  );
}
