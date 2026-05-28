// Tile-level rollup of OSM-style tag signals for the right sidebar.
//
// The function is source-agnostic: it reads `lanes`, `maxspeed`, `oneway`,
// and node `kind`/`highway` straight off feature properties. The local OSM
// extract strips most attribute tags (only `highway` and `name` survive), so
// the "missing" counts will be high there. The Overture stub populates the
// same keys, which is the whole point of the data-source toggle - the
// contrast surfaces immediately on tile click.

import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { TileFeature } from "@/lib/scoring";
import { bboxOfTile } from "@/lib/scoring";

export interface Distribution {
  values: Record<string, number>;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  missing: number;
  present: number;
}

export interface TileTagRollup {
  way_count: number;
  lanes: Distribution;
  maxspeed: Distribution;
  oneway_pct: number | null;
  oneway_present: number;
  signals: { traffic_signals: number; stop: number; give_way: number };
}

const EMPTY_DIST: Distribution = {
  values: {},
  p10: null,
  p50: null,
  p90: null,
  missing: 0,
  present: 0,
};

function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    // Strip OSM-style units (e.g. "30 mph", "50") and the rare ";" separator.
    const first = raw.split(";")[0].trim();
    const m = first.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    let n = parseFloat(m[0]);
    if (!Number.isFinite(n)) return null;
    if (/mph/i.test(raw)) n = n * 1.60934;
    return n;
  }
  return null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

function distribution(values: (number | null)[]): Distribution {
  const present: number[] = [];
  const buckets: Record<string, number> = {};
  let missing = 0;
  for (const v of values) {
    if (v == null) {
      missing++;
      continue;
    }
    present.push(v);
    const key = Number.isInteger(v) ? String(v) : v.toFixed(1);
    buckets[key] = (buckets[key] ?? 0) + 1;
  }
  present.sort((a, b) => a - b);
  return {
    values: buckets,
    p10: percentile(present, 0.1),
    p50: percentile(present, 0.5),
    p90: percentile(present, 0.9),
    missing,
    present: present.length,
  };
}

function featureTouchesBbox(
  geom: Geometry,
  b: { west: number; south: number; east: number; north: number },
): boolean {
  if (!geom) return false;
  if (geom.type === "Point") {
    const [x, y] = geom.coordinates;
    return x >= b.west && x <= b.east && y >= b.south && y <= b.north;
  }
  if (geom.type === "LineString") {
    for (const [x, y] of geom.coordinates) {
      if (x >= b.west && x <= b.east && y >= b.south && y <= b.north) return true;
    }
    return false;
  }
  if (geom.type === "MultiLineString") {
    for (const line of geom.coordinates) {
      for (const [x, y] of line) {
        if (x >= b.west && x <= b.east && y >= b.south && y <= b.north) return true;
      }
    }
    return false;
  }
  return false;
}

function isLineLike(g: Geometry | null): boolean {
  return !!g && (g.type === "LineString" || g.type === "MultiLineString");
}

function isPoint(g: Geometry | null): boolean {
  return !!g && g.type === "Point";
}

function onewayValue(raw: unknown): "yes" | "no" | null {
  if (raw == null) return null;
  const s = String(raw).toLowerCase().trim();
  if (s === "yes" || s === "true" || s === "1" || s === "-1") return "yes";
  if (s === "no" || s === "false" || s === "0") return "no";
  return null;
}

function nodeKind(props: Record<string, unknown> | null | undefined): string | null {
  if (!props) return null;
  // OSM extract uses `kind`; raw OSM uses `highway`. Support both.
  const kind = (props.kind as string | undefined) ?? (props.highway as string | undefined);
  if (!kind) return null;
  return String(kind);
}

export function rollupTagsForTile(
  tile: TileFeature,
  roads: FeatureCollection | { features: Feature[] } | null | undefined,
): TileTagRollup {
  if (!roads || !roads.features || roads.features.length === 0) {
    return {
      way_count: 0,
      lanes: { ...EMPTY_DIST, values: {} },
      maxspeed: { ...EMPTY_DIST, values: {} },
      oneway_pct: null,
      oneway_present: 0,
      signals: { traffic_signals: 0, stop: 0, give_way: 0 },
    };
  }

  const b = bboxOfTile(tile);
  const lanesVals: (number | null)[] = [];
  const speedVals: (number | null)[] = [];
  let onewayYes = 0;
  let onewayPresent = 0;
  let wayCount = 0;
  const signals = { traffic_signals: 0, stop: 0, give_way: 0 };

  for (const f of roads.features) {
    if (!f.geometry) continue;
    if (!featureTouchesBbox(f.geometry, b)) continue;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    if (isLineLike(f.geometry)) {
      wayCount++;
      lanesVals.push(parseNumber(p.lanes));
      speedVals.push(parseNumber(p.maxspeed));
      const ow = onewayValue(p.oneway);
      if (ow !== null) {
        onewayPresent++;
        if (ow === "yes") onewayYes++;
      }
    } else if (isPoint(f.geometry)) {
      const k = nodeKind(p);
      if (k === "traffic_signals") signals.traffic_signals++;
      else if (k === "stop") signals.stop++;
      else if (k === "give_way") signals.give_way++;
    }
  }

  return {
    way_count: wayCount,
    lanes: distribution(lanesVals),
    maxspeed: distribution(speedVals),
    oneway_pct: onewayPresent === 0 ? null : onewayYes / onewayPresent,
    oneway_present: onewayPresent,
    signals,
  };
}
