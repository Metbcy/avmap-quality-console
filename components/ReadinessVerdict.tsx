"use client";

// Plain-English readiness verdict for a tile. Translates the numeric
// readiness_score + validator flag mix into a single sentence a non-technical
// reader can act on. No new scoring logic, this is presentation only.

import type { TileProperties } from "@/lib/scoring";
import type { Flag } from "@/lib/validators";
import { countFlagsBySeverity } from "@/lib/scoring";

interface Props {
  tile: TileProperties;
  flags: Flag[];
  threshold?: number;
}

type Verdict = {
  emoji: string;
  headline: string;
  body: string;
  toneClass: string; // tailwind border + text color
  bgClass: string;
};

const DEFAULT_THRESHOLD = 0.9;
const CAUTION_BAND = 0.15;

export function verdictFor(
  tile: TileProperties,
  flags: Flag[],
  threshold: number = DEFAULT_THRESHOLD,
): Verdict {
  const counts = countFlagsBySeverity(flags);
  const score = tile.readiness_score;
  const caution = Math.max(0, threshold - CAUTION_BAND);

  // High-severity flag is a hard block regardless of score.
  if (counts.high > 0) {
    return {
      emoji: "🛑",
      headline: "Not safe for self-driving here",
      body: `${counts.high} critical issue${counts.high === 1 ? "" : "s"} flagged in this block. A human driver would handle this; an autonomous vehicle should reroute or hand off.`,
      toneClass: "border-red-700/60 text-red-200",
      bgClass: "bg-red-950/40",
    };
  }

  if (score >= threshold && counts.med === 0) {
    return {
      emoji: "✅",
      headline: "Ready for autonomous driving",
      body: "Lane markings, stop signs, and sensor agreement all check out. An AV should be able to drive this block with confidence.",
      toneClass: "border-emerald-700/60 text-emerald-200",
      bgClass: "bg-emerald-950/40",
    };
  }

  if (score >= caution) {
    const hint = counts.med > 0
      ? `${counts.med} medium-severity issue${counts.med === 1 ? "" : "s"} worth a second look`
      : "minor signal degradation";
    return {
      emoji: "⚠️",
      headline: "Drivable with caution",
      body: `Mostly fine, but ${hint}. An AV could drive this, but a map-quality reviewer should sign off before it goes live.`,
      toneClass: "border-yellow-700/60 text-yellow-100",
      bgClass: "bg-yellow-950/30",
    };
  }

  return {
    emoji: "🚧",
    headline: "Needs map work before AV use",
    body: "Too many quality signals are weak here: markings, stop signs, or sensor agreement. Send this block back to the mapping team before letting an AV drive it.",
    toneClass: "border-orange-700/60 text-orange-200",
    bgClass: "bg-orange-950/30",
  };
}

export default function ReadinessVerdict({ tile, flags, threshold }: Props) {
  const v = verdictFor(tile, flags, threshold);
  const pct = Math.round(tile.readiness_score * 100);
  return (
    <div
      className={`rounded border ${v.toneClass} ${v.bgClass} p-3`}
      data-testid="readiness-verdict"
    >
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none" aria-hidden>{v.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-tight">
            {v.headline}
          </div>
          <div className="mt-1 text-[11px] leading-snug text-gray-300">
            {v.body}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-500">
            <span>readiness</span>
            <span className="font-mono text-gray-300">{pct}/100</span>
          </div>
        </div>
      </div>
    </div>
  );
}
