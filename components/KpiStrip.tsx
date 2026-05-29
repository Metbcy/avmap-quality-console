"use client";

import type { CoverageKPIs } from "@/lib/kpi";

interface Props {
  kpis: CoverageKPIs;
  cityLabel: string;
  threshold: number;
}

export default function KpiStrip({ kpis, cityLabel, threshold }: Props) {
  return (
    <div
      className="flex flex-wrap items-center gap-4 border-b border-gray-800 bg-gray-950/80 px-5 py-2.5"
      data-testid="kpi-strip"
    >
      <Pill label="City" value={cityLabel} tone="indigo" />
      <Pill label="Tiles" value={fmt(kpis.total)} />
      <Pill
        label={`Ready (>=${threshold.toFixed(2)})`}
        value={`${kpis.pctReady.toFixed(0)}%`}
        sub={`${fmt(kpis.ready)}/${fmt(kpis.total)}`}
        tone={kpis.pctReady >= 75 ? "green" : kpis.pctReady >= 50 ? "yellow" : "red"}
      />
      <Pill
        label="Mean readiness"
        value={kpis.meanReadiness.toFixed(2)}
        tone={kpis.meanReadiness >= threshold ? "green" : "yellow"}
      />
      <Pill
        label="Flagged"
        value={fmt(kpis.flagged)}
        sub={`H${kpis.flagsHigh} M${kpis.flagsMed} L${kpis.flagsLow}`}
        tone={kpis.flagsHigh > 0 ? "red" : kpis.flagsMed > 0 ? "yellow" : "neutral"}
      />
      <Pill
        label="Oldest tile"
        value={`${kpis.oldestDays}d`}
        sub={kpis.staleCount > 0 ? `${kpis.staleCount} stale` : "all fresh"}
        tone={kpis.staleCount > 0 ? "yellow" : "green"}
      />
    </div>
  );
}

type Tone = "indigo" | "green" | "yellow" | "red" | "neutral";
const TONE: Record<Tone, string> = {
  indigo: "border-indigo-700/50 text-indigo-200",
  green: "border-emerald-700/50 text-emerald-200",
  yellow: "border-yellow-700/50 text-yellow-100",
  red: "border-red-700/60 text-red-200",
  neutral: "border-gray-700 text-gray-200",
};

function Pill({
  label, value, sub, tone = "neutral",
}: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className={`flex flex-col rounded-md border ${TONE[tone]} bg-gray-900/40 px-2.5 py-1`}>
      <span className="text-[9px] uppercase tracking-widest text-gray-500">{label}</span>
      <span className="font-mono text-[13px] leading-tight">{value}</span>
      {sub && <span className="font-mono text-[10px] text-gray-500">{sub}</span>}
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}
