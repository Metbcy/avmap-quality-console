// Coverage / readiness KPIs for a tile collection. Centralized so the triage
// strip and the multi-city /coverage page compute identical numbers.

import type { TileCollection, TileProperties } from "@/lib/scoring";
import type { Flag } from "@/lib/validators";

export interface CoverageKPIs {
  total: number;
  ready: number;        // readiness_score >= threshold
  flagged: number;      // total - ready
  pctReady: number;     // 0..100
  meanReadiness: number; // 0..1
  flagsTotal: number;
  flagsHigh: number;
  flagsMed: number;
  flagsLow: number;
  oldestDays: number;   // max age in days vs now
  freshDays: number;    // min age in days vs now (most recently validated)
  staleCount: number;   // tiles older than STALE_DAYS
}

export const STALE_DAYS = 30;

export function computeKPIs(
  tiles: TileCollection,
  flags: Flag[],
  threshold: number,
  now: number = Date.now(),
): CoverageKPIs {
  const total = tiles.features.length;
  let ready = 0;
  let sum = 0;
  let oldestDays = 0;
  let freshDays = Number.POSITIVE_INFINITY;
  let staleCount = 0;

  for (const f of tiles.features) {
    const p: TileProperties = f.properties;
    if (p.readiness_score >= threshold) ready++;
    sum += p.readiness_score;
    const ageDays = tileAgeDays(p, now);
    if (ageDays > oldestDays) oldestDays = ageDays;
    if (ageDays < freshDays) freshDays = ageDays;
    if (ageDays > STALE_DAYS) staleCount++;
  }

  let high = 0, med = 0, low = 0;
  for (const fl of flags) {
    const sev = fl.properties?.severity;
    if (sev === "high") high++;
    else if (sev === "med") med++;
    else if (sev === "low") low++;
  }

  return {
    total,
    ready,
    flagged: total - ready,
    pctReady: total ? (ready / total) * 100 : 0,
    meanReadiness: total ? sum / total : 0,
    flagsTotal: flags.length,
    flagsHigh: high,
    flagsMed: med,
    flagsLow: low,
    oldestDays: Math.round(oldestDays),
    freshDays: Number.isFinite(freshDays) ? Math.round(freshDays) : 0,
    staleCount,
  };
}

export function tileAgeDays(p: TileProperties, now: number = Date.now()): number {
  const t = Date.parse(p.last_validated_at);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now - t) / 86_400_000);
}
