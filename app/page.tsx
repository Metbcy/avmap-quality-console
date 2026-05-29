"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { FeatureCollection } from "geojson";
import { asset } from "@/lib/asset";
import {
  CITIES,
  countFlagsBySeverity,
  flagCentroid,
  generateTiles,
  filterTilesToRoads,
  indexFlagsByTile,
  tileIssues,
  tileWithFlagScore,
  type CityId,
  type TileCollection,
  type TileFeature,
  type TileProperties,
} from "@/lib/scoring";
import type { Flag, Severity } from "@/lib/validators";
import { RULES, runValidators } from "@/lib/validators";
import RuleLegend from "@/components/RuleLegend";
import TileSignals from "@/components/TileSignals";
import ReadinessVerdict from "@/components/ReadinessVerdict";
import TopBar from "@/components/TopBar";
import KpiStrip from "@/components/KpiStrip";
import { computeKPIs } from "@/lib/kpi";
import { rollupTagsForTile } from "@/lib/osm/tag-rollup";
import type { MapViewHandle } from "@/components/MapView";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const RULE_TITLE: Record<string, string> = Object.fromEntries(
  RULES.map((r) => [r.id, r.title]),
);

const SEVERITY_DOT_CLASS: Record<Severity, string> = {
  low: "bg-green-400",
  med: "bg-yellow-400",
  high: "bg-red-500",
};

export type DataSource = "osm" | "overture";

const SOURCE_LABEL: Record<DataSource, string> = {
  osm: "OSM",
  overture: "Overture",
};

// Overture transportation extract is only synthesised for SF in this build.
// Falling back to OSM for any city that has no Overture file keeps the toggle
// non-destructive (see Sidebar where the Overture pill is disabled).
const OVERTURE_AVAILABLE: Partial<Record<CityId, boolean>> = { sf: true };

function roadsUrl(city: CityId, source: DataSource): string {
  if (source === "overture" && OVERTURE_AVAILABLE[city]) {
    return asset(`/data/${city}_overture.geojson`);
  }
  return asset(`/data/${city}.geojson`);
}

export default function TriagePage() {
  const [city, setCity] = useState<CityId>("sf");
  const [dataSource, setDataSource] = useState<DataSource>("osm");
  const [threshold, setThreshold] = useState(0.8);
  const [showOnlyFlagged, setShowOnlyFlagged] = useState(false);
  const [selected, setSelected] = useState<TileProperties | null>(null);
  const [queued, setQueued] = useState<Record<string, boolean>>({});
  const [flagsByCity, setFlagsByCity] = useState<Record<CityId, Flag[]>>({ sf: [], mv: [] });
  const [roads, setRoads] = useState<FeatureCollection | null>(null);
  const [overtureFlags, setOvertureFlags] = useState<Flag[]>([]);
  // Cache fetched roads keyed by `${city}:${source}` so toggling source or
  // bouncing between cities is instant after the first fetch. Same cache for
  // Overture-derived flags so we don't re-run the validator pass either.
  const roadsCacheRef = useRef<Map<string, FeatureCollection>>(new Map());
  const overtureFlagsCacheRef = useRef<Map<string, Flag[]>>(new Map());
  const mapRef = useRef<MapViewHandle>(null);

  // Effective source: gracefully fall back to OSM when Overture is unavailable
  // for the selected city.
  const effectiveSource: DataSource =
    dataSource === "overture" && OVERTURE_AVAILABLE[city] ? "overture" : "osm";

  // Load precomputed flags per city, lazily. Falls back to an empty array if
  // the file is missing - tile scoring then uses the synthetic signal.
  useEffect(() => {
    // Skip if we've already attempted a fetch for this city (the key exists
    // even when the resulting array is empty; checking .length re-fetches
    // forever on cities with zero precomputed flags).
    if (city in flagsByCity) return;
    let cancelled = false;
    fetch(asset(`/data/${city}.flags.json`))
      .then((r) => (r.ok ? r.json() : { type: "FeatureCollection", features: [] }))
      .then((data: FeatureCollection) => {
        if (cancelled) return;
        setFlagsByCity((prev) => ({ ...prev, [city]: data.features as Flag[] }));
      })
      .catch(() => {
        if (cancelled) return;
        // Record empty result so we don't retry on every render.
        setFlagsByCity((prev) => ({ ...prev, [city]: [] }));
      });
    return () => { cancelled = true; };
  }, [city, flagsByCity]);

  // Load roads for the current (city, source). Roads feed the basemap line
  // layer, the OSM tag rollup, and (for Overture) the in-browser validator
  // pass that produces the flag set used by scoring. We never pre-clear the
  // existing roads here - the request token below discards stale responses,
  // and avoiding the pre-clear keeps the effect free of cascading renders.
  useEffect(() => {
    const key = `${city}:${effectiveSource}`;
    // Cache hit: swap state synchronously, no network, no validator pass.
    const cachedRoads = roadsCacheRef.current.get(key);
    if (cachedRoads) {
      setRoads(cachedRoads);
      setOvertureFlags(
        effectiveSource === "overture"
          ? overtureFlagsCacheRef.current.get(key) ?? []
          : [],
      );
      return;
    }
    let cancelled = false;
    fetch(roadsUrl(city, effectiveSource))
      .then((r) => (r.ok ? r.json() : { type: "FeatureCollection", features: [] }))
      .then((data: FeatureCollection) => {
        if (cancelled) return;
        roadsCacheRef.current.set(key, data);
        setRoads(data);
        if (effectiveSource === "overture") {
          // ~500 ways: cheap enough to validate in-browser. Same rules, same
          // severity weights -> readiness numbers are directly comparable
          // across OSM and Overture.
          const flags = runValidators(data.features) as Flag[];
          overtureFlagsCacheRef.current.set(key, flags);
          setOvertureFlags(flags);
        } else {
          setOvertureFlags([]);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRoads({ type: "FeatureCollection", features: [] });
        setOvertureFlags([]);
      });
    return () => { cancelled = true; };
  }, [city, effectiveSource]);

  // Warm the cache for the OTHER source so the first toggle is also instant.
  // Runs idle, not on the critical path; same key shape as the main effect.
  useEffect(() => {
    if (!OVERTURE_AVAILABLE[city]) return;
    const other: DataSource = effectiveSource === "osm" ? "overture" : "osm";
    const key = `${city}:${other}`;
    if (roadsCacheRef.current.has(key)) return;
    const run = () => {
      fetch(roadsUrl(city, other))
        .then((r) => (r.ok ? r.json() : { type: "FeatureCollection", features: [] }))
        .then((data: FeatureCollection) => {
          roadsCacheRef.current.set(key, data);
          if (other === "overture") {
            overtureFlagsCacheRef.current.set(key, runValidators(data.features) as Flag[]);
          }
        })
        .catch(() => { /* prefetch failure is silent */ });
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(run);
    else setTimeout(run, 500);
  }, [city, effectiveSource]);

  const baseTiles = useMemo(() => {
    const all = generateTiles(city);
    // Trim tiles that have no road geometry, which removes open-water cells
    // (Pacific, Bay) while keeping bridge spans because road LineStrings cross
    // them. Only filters once roads have loaded; before that we render the
    // full grid so the map doesn't briefly go empty on city switch.
    return filterTilesToRoads(all, roads);
  }, [city, roads]);
  const flags = effectiveSource === "overture" ? overtureFlags : flagsByCity[city];

  // Bucket flags into tiles once per (city, flags) change so the per-tile
  // detail and badge lookups are O(1).
  const flagsByTile = useMemo(() => indexFlagsByTile(baseTiles, flags), [baseTiles, flags]);

  const tiles: TileCollection = useMemo(() => ({
    type: "FeatureCollection",
    features: baseTiles.features.map((t) =>
      tileWithFlagScore(t, flagsByTile.get(t.properties.tile_id) ?? []),
    ),
  }), [baseTiles, flagsByTile]);

  const stats = useMemo(
    () => computeKPIs(tiles, flags, threshold),
    [tiles, flags, threshold],
  );

  const handleTileClick = (f: TileFeature) => setSelected(f.properties);
  const queueKey = selected ? `${selected.city}:${selected.tile_id}` : "";
  const isQueued = queueKey && queued[queueKey];
  const selectedFlags = selected ? flagsByTile.get(selected.tile_id) ?? [] : [];
  const selectedTileFeature = useMemo(() => {
    if (!selected) return null;
    return tiles.features.find((t) => t.properties.tile_id === selected.tile_id) ?? null;
  }, [selected, tiles]);
  const selectedRollup = useMemo(() => {
    if (!selectedTileFeature) return null;
    return rollupTagsForTile(selectedTileFeature, roads);
  }, [selectedTileFeature, roads]);

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      <TopBar active="triage" />
      <KpiStrip kpis={stats} cityLabel={CITIES[city].label} threshold={threshold} />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          city={city}
          setCity={(c) => { setCity(c); setSelected(null); }}
          dataSource={dataSource}
          setDataSource={(s) => { setDataSource(s); setSelected(null); }}
          overtureAvailable={!!OVERTURE_AVAILABLE[city]}
          threshold={threshold}
          setThreshold={setThreshold}
          showOnlyFlagged={showOnlyFlagged}
          setShowOnlyFlagged={setShowOnlyFlagged}
          flagCount={flags.length}
        />
        <div className="relative flex-1">
          <MapView
            ref={mapRef}
            city={city}
            tiles={tiles}
            threshold={threshold}
            showOnlyFlagged={showOnlyFlagged}
            flags={flags}
            roads={roads}
            sourceLabel={SOURCE_LABEL[effectiveSource]}
            onTileClick={handleTileClick}
          />
          <RuleLegend />
        </div>
        <DetailPanel
          selected={selected}
          selectedFlags={selectedFlags}
          rollup={selectedRollup}
          sourceLabel={SOURCE_LABEL[effectiveSource]}
          isQueued={!!isQueued}
          threshold={threshold}
          onQueue={() => { if (queueKey) setQueued((q) => ({ ...q, [queueKey]: true })); }}
          onFlyToFlag={(f) => {
            const p = flagCentroid(f);
            if (p) mapRef.current?.flyTo(p[0], p[1]);
          }}
        />
      </div>
    </div>
  );
}

function Sidebar(props: {
  city: CityId;
  setCity: (c: CityId) => void;
  dataSource: DataSource;
  setDataSource: (s: DataSource) => void;
  overtureAvailable: boolean;
  threshold: number;
  setThreshold: (n: number) => void;
  showOnlyFlagged: boolean;
  setShowOnlyFlagged: (b: boolean) => void;
  flagCount: number;
}) {
  const {
    city, setCity, dataSource, setDataSource, overtureAvailable,
    threshold, setThreshold, showOnlyFlagged, setShowOnlyFlagged, flagCount,
  } = props;
  return (
    <aside className="flex w-80 shrink-0 flex-col gap-5 border-r border-gray-800 bg-gray-950 px-4 py-4">
      <Section title="Data source">
        <div className="flex gap-1 rounded border border-gray-800 bg-gray-900 p-0.5">
          <DataSourcePill
            label="OSM"
            active={dataSource === "osm"}
            onClick={() => setDataSource("osm")}
            disabled={false}
          />
          <DataSourcePill
            label="Overture"
            active={dataSource === "overture"}
            onClick={() => setDataSource("overture")}
            disabled={!overtureAvailable}
            title={overtureAvailable ? undefined : "Overture extract not available for this city"}
          />
        </div>
        {!overtureAvailable && dataSource === "overture" && (
          <div className="mt-1 text-[10px] text-gray-500">
            Falling back to OSM for this city.
          </div>
        )}
        {overtureAvailable && dataSource === "overture" && (
          <div className="mt-1 rounded border border-amber-900/60 bg-amber-950/40 px-2 py-1 text-[10px] leading-snug text-amber-200">
            <span className="font-semibold uppercase tracking-wide">Synthesized</span>
            {" "}Overture stub: 500 ways perturbed from local OSM with 26 intentional divergences. A real Overture pull requires S3/DuckDB at build time.
          </div>
        )}
      </Section>

      <Section title="City">
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(CITIES) as CityId[]).map((id) => {
            const active = city === id;
            return (
              <button
                key={id}
                onClick={() => setCity(id)}
                className={`rounded border px-2 py-2 text-left text-xs transition ${active ? "border-indigo-500 bg-indigo-500/10 text-indigo-200" : "border-gray-800 bg-gray-900 text-gray-300 hover:border-gray-700"}`}
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
          type="range" min={0.5} max={1} step={0.01} value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          className="mt-2 w-full accent-indigo-500"
        />
      </Section>

      <Section title="Filter">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
          <input type="checkbox" checked={showOnlyFlagged} onChange={(e) => setShowOnlyFlagged(e.target.checked)} className="h-3.5 w-3.5 accent-indigo-500" />
          Show only flagged
        </label>
      </Section>

      <Section title="Validator flags">
        <div className="font-mono text-xs text-gray-300">{flagCount.toLocaleString()} total</div>
        <div className="text-[10px] text-gray-500">computed offline, see /scripts/compute-flags.ts</div>
      </Section>

      <Section title="Legend">
        <ul className="space-y-1 text-xs text-gray-400">
          <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-emerald-500/60" />ready (≥ 0.90)</li>
          <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-yellow-500/70" />review (0.75 – 0.90)</li>
          <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-red-500/70" />blocked (&lt; 0.75)</li>
        </ul>
      </Section>

      <div className="mt-auto text-[10px] leading-snug text-gray-500">
        Road network © OpenStreetMap contributors, ODbL. Basemap © CARTO.
        Tile readiness derived from Atlas-Checks-style validators over the
        local OSM extract; synthetic signals shown as supporting context.
      </div>
    </aside>
  );
}

function DataSourcePill({
  label, active, onClick, disabled, title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const base = "flex-1 rounded px-2 py-1 text-xs transition";
  const cls = disabled
    ? `${base} cursor-not-allowed text-gray-600`
    : active
      ? `${base} border border-indigo-500 bg-indigo-500/10 text-indigo-200`
      : `${base} border border-transparent text-gray-400 hover:text-gray-200`;
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className={cls} title={title}>
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">{title}</div>
      {children}
    </div>
  );
}

function DetailPanel({
  selected, selectedFlags, rollup, sourceLabel, isQueued, threshold, onQueue, onFlyToFlag,
}: {
  selected: TileProperties | null;
  selectedFlags: Flag[];
  rollup: import("@/lib/osm/tag-rollup").TileTagRollup | null;
  sourceLabel: string;
  isQueued: boolean;
  threshold: number;
  onQueue: () => void;
  onFlyToFlag: (f: Flag) => void;
}) {
  return (
    <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-gray-800 bg-gray-950 px-4 py-4">
      {!selected ? (
        <div className="text-xs text-gray-500">Select a tile on the map to inspect its readiness signals.</div>
      ) : (
        <SelectedDetail
          tile={selected}
          flags={selectedFlags}
          rollup={rollup}
          sourceLabel={sourceLabel}
          isQueued={isQueued}
          threshold={threshold}
          onQueue={onQueue}
          onFlyToFlag={onFlyToFlag}
        />
      )}
    </aside>
  );
}

function FlagBadgeRow({ flags }: { flags: Flag[] }) {
  const counts = countFlagsBySeverity(flags);
  if (counts.total === 0) return null;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {counts.high > 0 && <span className="font-mono text-red-400">🔴 {counts.high}</span>}
      {counts.med > 0 && <span className="font-mono text-yellow-300">🟡 {counts.med}</span>}
      {counts.low > 0 && <span className="font-mono text-green-300">🟢 {counts.low}</span>}
    </div>
  );
}

function SelectedDetail({
  tile, flags, rollup, sourceLabel, isQueued, threshold, onQueue, onFlyToFlag,
}: {
  tile: TileProperties;
  flags: Flag[];
  rollup: import("@/lib/osm/tag-rollup").TileTagRollup | null;
  sourceLabel: string;
  isQueued: boolean;
  threshold: number;
  onQueue: () => void;
  onFlyToFlag: (f: Flag) => void;
}) {
  const issues = tileIssues(tile);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="font-mono text-sm text-indigo-300">{tile.tile_id}</div>
        <div className="font-mono text-xs text-gray-400">{tile.lat.toFixed(6)}, {tile.lng.toFixed(6)}</div>
        <div className="mt-1 text-[10px] uppercase tracking-widest text-gray-600">
          {tile.city.toUpperCase()} · validated {tile.last_validated_at.slice(0, 10)}
        </div>
        <div className="mt-2"><FlagBadgeRow flags={flags} /></div>
      </div>

      <ReadinessVerdict tile={tile} flags={flags} threshold={threshold} />

      {rollup && <TileSignals rollup={rollup} sourceLabel={sourceLabel} />}

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Score breakdown</div>
        <div className="space-y-2">
          <Bar label="lane_marking_confidence" value={tile.lane_marking_confidence} />
          <Bar label="sensor_agreement" value={1 - tile.sensor_divergence_score} />
          <Bar label="stop_sign_confidence" value={tile.stop_sign_confidence} />
          <Bar label="readiness_score" value={tile.readiness_score} accent />
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Validator flags ({flags.length})
        </div>
        {flags.length === 0 ? (
          <div className="text-xs text-gray-500">No validator flags in this tile.</div>
        ) : (
          <ul className="space-y-2">
            {flags.slice(0, 30).map((f, i) => (
              <li
                key={`${f.properties.rule_id}-${i}`}
                className="rounded border border-gray-800 bg-gray-900/50 p-2"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[f.properties.severity]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[10px] text-indigo-300">{f.properties.rule_id}</span>
                      <button
                        onClick={() => onFlyToFlag(f)}
                        className="shrink-0 rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300 hover:border-indigo-500 hover:text-indigo-300"
                      >
                        fly to
                      </button>
                    </div>
                    <div className="text-[10px] text-gray-500">{RULE_TITLE[f.properties.rule_id] ?? ""}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-gray-300">{f.properties.description}</div>
                  </div>
                </div>
              </li>
            ))}
            {flags.length > 30 && (
              <li className="text-[10px] text-gray-500">{flags.length - 30} more flag(s) not shown</li>
            )}
          </ul>
        )}
      </div>

      {issues.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Supporting signals
          </div>
          <ul className="space-y-1">
            {issues.map((i) => (
              <li key={i.code} className="flex items-start gap-2 text-xs text-gray-300">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-500" />
                <span>{i.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pt-1">
        {isQueued ? (
          <span className="inline-block rounded border border-indigo-700 bg-gray-800 px-2 py-0.5 text-xs text-indigo-300">simulation queued</span>
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
        <div className={`h-full ${accent ? "bg-indigo-400" : "bg-gray-400"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatsStrip(_: { total: number; ready: number; flagged: number; pctReady: number; flagsTotal: number }) {
  return null;
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
      <span className={`font-mono ${highlight ? "text-red-400" : "text-gray-200"}`}>{value}</span>
    </div>
  );
}
