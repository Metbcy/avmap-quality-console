"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CITIES, generateTiles, tileIssues, type CityId, type TileFeature, type TileProperties } from "@/lib/scoring";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function TriagePage() {
  const [city, setCity] = useState<CityId>("sf");
  const [threshold, setThreshold] = useState(0.8);
  const [showOnlyFlagged, setShowOnlyFlagged] = useState(false);
  const [selected, setSelected] = useState<TileProperties | null>(null);
  const [queued, setQueued] = useState<Record<string, boolean>>({});

  const tiles = useMemo(() => generateTiles(city), [city]);

  const stats = useMemo(() => {
    const total = tiles.features.length;
    let above = 0;
    let latestTs = 0;
    let latestIso = "";
    for (const f of tiles.features) {
      if (f.properties.readiness_score >= threshold) above++;
      const t = Date.parse(f.properties.last_validated_at);
      if (t > latestTs) {
        latestTs = t;
        latestIso = f.properties.last_validated_at;
      }
    }
    return {
      total,
      above,
      flagged: total - above,
      pct: total ? (above / total) * 100 : 0,
      latest: latestIso,
    };
  }, [tiles, threshold]);

  const handleTileClick = (f: TileFeature) => setSelected(f.properties);

  const queueKey = selected ? `${selected.city}:${selected.tile_id}` : "";
  const isQueued = queueKey && queued[queueKey];

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      <TopBar active="triage" />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          city={city}
          setCity={(c) => {
            setCity(c);
            setSelected(null);
          }}
          threshold={threshold}
          setThreshold={setThreshold}
          showOnlyFlagged={showOnlyFlagged}
          setShowOnlyFlagged={setShowOnlyFlagged}
        />
        <div className="relative flex-1">
          <MapView
            city={city}
            tiles={tiles}
            threshold={threshold}
            showOnlyFlagged={showOnlyFlagged}
            onTileClick={handleTileClick}
          />
        </div>
        <DetailPanel
          selected={selected}
          isQueued={!!isQueued}
          onQueue={() => {
            if (queueKey) setQueued((q) => ({ ...q, [queueKey]: true }));
          }}
        />
      </div>
      <StatsStrip {...stats} />
    </div>
  );
}

function TopBar({ active }: { active: "triage" | "diff" }) {
  return (
    <div className="flex h-12 items-center justify-between border-b border-gray-800 bg-gray-950 px-4">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-sm bg-indigo-400" />
        <span className="text-sm font-medium tracking-tight">AV Map Quality Console</span>
      </div>
      <nav className="flex gap-1 text-xs">
        <Link
          href="/"
          className={`rounded px-2.5 py-1 ${
            active === "triage" ? "bg-gray-800 text-indigo-300" : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Triage
        </Link>
        <Link
          href="/diff"
          className={`rounded px-2.5 py-1 ${
            active === "diff" ? "bg-gray-800 text-indigo-300" : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Diff
        </Link>
      </nav>
    </div>
  );
}

function Sidebar(props: {
  city: CityId;
  setCity: (c: CityId) => void;
  threshold: number;
  setThreshold: (n: number) => void;
  showOnlyFlagged: boolean;
  setShowOnlyFlagged: (b: boolean) => void;
}) {
  const { city, setCity, threshold, setThreshold, showOnlyFlagged, setShowOnlyFlagged } = props;
  return (
    <aside className="flex w-80 shrink-0 flex-col gap-5 border-r border-gray-800 bg-gray-950 px-4 py-4">
      <Section title="City">
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(CITIES) as CityId[]).map((id) => {
            const active = city === id;
            return (
              <button
                key={id}
                onClick={() => setCity(id)}
                className={`rounded border px-2 py-2 text-left text-xs transition ${
                  active
                    ? "border-indigo-500 bg-indigo-500/10 text-indigo-200"
                    : "border-gray-800 bg-gray-900 text-gray-300 hover:border-gray-700"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wider text-gray-500">{id}</div>
                <div className="text-xs">{CITIES[id].label}</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Readiness threshold">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">≥</span>
          <span className="font-mono text-indigo-300">{threshold.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={1}
          step={0.01}
          value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          className="mt-2 w-full accent-indigo-500"
        />
      </Section>

      <Section title="Filter">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={showOnlyFlagged}
            onChange={(e) => setShowOnlyFlagged(e.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-500"
          />
          Show only flagged
        </label>
      </Section>

      <Section title="Legend">
        <ul className="space-y-1 text-xs text-gray-400">
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-emerald-500/60" />
            ready (≥ 0.90)
          </li>
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-yellow-500/70" />
            review (0.75 – 0.90)
          </li>
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-red-500/70" />
            blocked (&lt; 0.75)
          </li>
        </ul>
      </Section>

      <div className="mt-auto text-[10px] leading-snug text-gray-500">
        Road network © OpenStreetMap contributors, ODbL. Basemap © CARTO.
        Synthetic scores generated locally with a deterministic seeded PRNG.
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

function DetailPanel({
  selected,
  isQueued,
  onQueue,
}: {
  selected: TileProperties | null;
  isQueued: boolean;
  onQueue: () => void;
}) {
  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-gray-800 bg-gray-950 px-4 py-4">
      {!selected ? (
        <div className="text-xs text-gray-500">
          Select a tile on the map to inspect its readiness signals.
        </div>
      ) : (
        <SelectedDetail tile={selected} isQueued={isQueued} onQueue={onQueue} />
      )}
    </aside>
  );
}

function SelectedDetail({
  tile,
  isQueued,
  onQueue,
}: {
  tile: TileProperties;
  isQueued: boolean;
  onQueue: () => void;
}) {
  const issues = tileIssues(tile);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="font-mono text-sm text-indigo-300">{tile.tile_id}</div>
        <div className="font-mono text-xs text-gray-400">
          {tile.lat.toFixed(6)}, {tile.lng.toFixed(6)}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-widest text-gray-600">
          {tile.city.toUpperCase()} · validated {tile.last_validated_at.slice(0, 10)}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Score breakdown
        </div>
        <div className="space-y-2">
          <Bar label="lane_marking_confidence" value={tile.lane_marking_confidence} />
          <Bar label="sensor_agreement" value={1 - tile.sensor_divergence_score} />
          <Bar label="stop_sign_confidence" value={tile.stop_sign_confidence} />
          <Bar label="readiness_score" value={tile.readiness_score} accent />
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Issues
        </div>
        {issues.length === 0 ? (
          <div className="text-xs text-gray-500">No issues detected</div>
        ) : (
          <ul className="space-y-1">
            {issues.map((i) => (
              <li
                key={i.code}
                className="flex items-start gap-2 text-xs text-gray-300"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                <span>{i.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-1">
        {isQueued ? (
          <span className="inline-block rounded border border-indigo-700 bg-gray-800 px-2 py-0.5 text-xs text-indigo-300">
            simulation queued
          </span>
        ) : (
          <button
            onClick={onQueue}
            className="rounded bg-indigo-500 px-3 py-1.5 text-sm font-medium text-gray-950 hover:bg-indigo-400"
          >
            Trigger re-validation
          </button>
        )}
      </div>
    </div>
  );
}

function Bar({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className={accent ? "font-medium text-indigo-300" : "text-gray-400"}>{label}</span>
        <span className="font-mono text-gray-300">{value.toFixed(2)}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-gray-800">
        <div
          className={`h-full ${accent ? "bg-indigo-400" : "bg-gray-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatsStrip({
  total,
  above,
  flagged,
  pct,
  latest,
}: {
  total: number;
  above: number;
  flagged: number;
  pct: number;
  latest: string;
}) {
  return (
    <div className="flex h-10 items-center gap-6 border-t border-gray-800 bg-gray-950 px-4 text-xs">
      <Stat label="total tiles" value={total.toString()} />
      <Stat label="above threshold" value={`${pct.toFixed(1)}%`} />
      <Stat label="flagged" value={flagged.toString()} highlight={flagged > 0} />
      <Stat label="above count" value={above.toString()} />
      <div className="ml-auto flex items-center gap-2 text-gray-500">
        <span className="text-[10px] uppercase tracking-widest">last validated</span>
        <span className="font-mono text-gray-300">{latest ? latest.slice(0, 19) + "Z" : "—"}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
      <span className={`font-mono ${highlight ? "text-red-400" : "text-gray-200"}`}>{value}</span>
    </div>
  );
}
