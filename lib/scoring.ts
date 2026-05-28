// Deterministic seeded scoring for synthetic readiness tiles, plus the real
// flag-driven scoring path used by the triage page. The synthetic metrics
// remain as supporting context for tiles that have zero validator flags.

import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { Flag, Severity } from "./validators";
import { SEVERITY_WEIGHT } from "./validators";

export type CityId = "sf" | "mv";

export interface CityBbox {
  id: CityId;
  label: string;
  south: number;
  west: number;
  north: number;
  east: number;
  center: [number, number];
  zoom: number;
}

export const CITIES: Record<CityId, CityBbox> = {
  sf: {
    id: "sf",
    label: "San Francisco",
    south: 37.7,
    west: -122.52,
    north: 37.83,
    east: -122.36,
    center: [-122.44, 37.77],
    zoom: 12,
  },
  mv: {
    id: "mv",
    label: "Mountain View",
    south: 37.36,
    west: -122.12,
    north: 37.43,
    east: -122.04,
    center: [-122.08, 37.39],
    zoom: 13,
  },
};

export interface TileProperties {
  tile_id: string;
  city: CityId;
  lat: number;
  lng: number;
  lane_marking_confidence: number;
  construction_flag: boolean;
  sensor_divergence_score: number;
  stop_sign_confidence: number;
  readiness_score: number;
  last_validated_at: string;
  // For MapLibre data-driven styling - numeric bucket: 0=red,1=yellow,2=green
  bucket: number;
}

export type TileFeature = Feature<Polygon, TileProperties>;
export type TileCollection = FeatureCollection<Polygon, TileProperties>;

// FNV-1a 32-bit -> seed for mulberry32
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function readinessScore(p: Pick<
  TileProperties,
  "lane_marking_confidence" | "sensor_divergence_score" | "stop_sign_confidence" | "construction_flag"
>): number {
  const base =
    0.45 * p.lane_marking_confidence +
    0.3 * (1 - p.sensor_divergence_score) +
    0.25 * p.stop_sign_confidence;
  return p.construction_flag ? Math.min(base, 0.55) : base;
}

function bucketOf(score: number): number {
  if (score >= 0.9) return 2;
  if (score >= 0.75) return 1;
  return 0;
}

const MAX_AXIS = 60; // cap at 60x60 = 3600 tiles

/**
 * Build a synthetic ~100-500m tile grid over a city's bbox.
 * Caps at MAX_AXIS x MAX_AXIS to stay performant.
 */
export function generateTiles(cityId: CityId): TileCollection {
  const city = CITIES[cityId];
  const latSpan = city.north - city.south;
  const lngSpan = city.east - city.west;

  const latStep0 = 0.0009;
  const lngStep0 = 0.00114;

  let rows = Math.ceil(latSpan / latStep0);
  let cols = Math.ceil(lngSpan / lngStep0);
  const k = Math.max(rows / MAX_AXIS, cols / MAX_AXIS, 1);
  rows = Math.ceil(rows / k);
  cols = Math.ceil(cols / k);

  const latStep = latSpan / rows;
  const lngStep = lngSpan / cols;

  const features: TileFeature[] = [];
  // Pin to a deterministic reference time so SSR/client outputs match.
  const now = Date.UTC(2026, 4, 28, 14, 0, 0);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const south = city.south + r * latStep;
      const north = south + latStep;
      const west = city.west + c * lngStep;
      const east = west + lngStep;
      const lat = (south + north) / 2;
      const lng = (west + east) / 2;

      const tile_id = `T-${String(r).padStart(3, "0")}-${String(c).padStart(3, "0")}`;
      const rng = mulberry32(fnv1a(`${cityId}:${tile_id}`));

      const lane_marking_confidence = Math.min(1, Math.max(0, 0.6 + rng() * 0.45 - 0.05));
      const sensor_divergence_score = Math.min(1, Math.max(0, rng() * 0.55));
      const stop_sign_confidence = Math.min(1, Math.max(0, 0.55 + rng() * 0.5 - 0.05));
      const construction_flag = rng() < 0.03;

      const readiness = readinessScore({
        lane_marking_confidence,
        sensor_divergence_score,
        stop_sign_confidence,
        construction_flag,
      });

      const daysAgo = Math.floor(rng() * 30);
      const last_validated_at = new Date(now - daysAgo * 86400_000).toISOString();

      features.push({
        type: "Feature",
        properties: {
          tile_id,
          city: cityId,
          lat,
          lng,
          lane_marking_confidence,
          construction_flag,
          sensor_divergence_score,
          stop_sign_confidence,
          readiness_score: readiness,
          last_validated_at,
          bucket: bucketOf(readiness),
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

/**
 * Drop tiles that contain no road geometry at all. Keeps bridges (Bay Bridge,
 * Golden Gate, San Mateo) because OSM/Overture road LineStrings cross them, so
 * those tiles still contain road vertices. Pure-water tiles disappear because
 * no road LineString has a vertex inside them. Falls back to all tiles if the
 * roads feed is missing or empty so the page never goes blank.
 */
export function filterTilesToRoads(
  tiles: TileCollection,
  roads: FeatureCollection | null | undefined,
): TileCollection {
  if (!roads || !roads.features || roads.features.length === 0) return tiles;

  // Build a coarse spatial index keyed by tile (row,col) so we don't do an
  // O(tiles * vertices) sweep. We assume a uniform grid (which generateTiles
  // produces) and derive step from the first tile's bbox.
  if (tiles.features.length === 0) return tiles;
  const first = tiles.features[0].geometry.coordinates[0];
  // Polygon ring: [SW, SE, NE, NW, SW]
  const [w0, s0] = first[0];
  const [e0, n0] = first[2];
  const lngStep = e0 - w0;
  const latStep = n0 - s0;
  if (lngStep <= 0 || latStep <= 0) return tiles;

  // Use the bbox of the whole tile set as the grid origin.
  let minW = Infinity, minS = Infinity;
  for (const t of tiles.features) {
    const ring = t.geometry.coordinates[0];
    if (ring[0][0] < minW) minW = ring[0][0];
    if (ring[0][1] < minS) minS = ring[0][1];
  }

  // Map (col,row) -> tile feature.
  const tileByCell = new Map<string, TileFeature>();
  for (const t of tiles.features) {
    const ring = t.geometry.coordinates[0];
    const col = Math.round((ring[0][0] - minW) / lngStep);
    const row = Math.round((ring[0][1] - minS) / latStep);
    tileByCell.set(`${col}:${row}`, t);
  }

  const kept = new Set<string>();
  const stamp = (lng: number, lat: number) => {
    const col = Math.floor((lng - minW) / lngStep);
    const row = Math.floor((lat - minS) / latStep);
    const key = `${col}:${row}`;
    if (tileByCell.has(key)) kept.add(key);
  };

  for (const f of roads.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "LineString") {
      for (const c of g.coordinates) stamp(c[0], c[1]);
    } else if (g.type === "MultiLineString") {
      for (const line of g.coordinates) for (const c of line) stamp(c[0], c[1]);
    } else if (g.type === "Point") {
      stamp(g.coordinates[0], g.coordinates[1]);
    } else if (g.type === "MultiPoint") {
      for (const c of g.coordinates) stamp(c[0], c[1]);
    }
  }

  // Safety: if we somehow filter everything out (e.g. coordinate mismatch),
  // fall back to the unfiltered set rather than render an empty map.
  if (kept.size === 0) return tiles;

  return {
    type: "FeatureCollection",
    features: tiles.features.filter((t) => {
      const ring = t.geometry.coordinates[0];
      const col = Math.round((ring[0][0] - minW) / lngStep);
      const row = Math.round((ring[0][1] - minS) / latStep);
      return kept.has(`${col}:${row}`);
    }),
  };
}

export interface TileIssue {
  code: string;
  label: string;
}

export function tileIssues(p: TileProperties): TileIssue[] {
  const out: TileIssue[] = [];
  if (p.construction_flag)
    out.push({ code: "construction", label: "Active construction reported" });
  if (p.lane_marking_confidence < 0.7)
    out.push({ code: "lane_low", label: "Lane markings below threshold" });
  if (p.sensor_divergence_score > 0.4)
    out.push({ code: "sensor_div", label: "Elevated sensor divergence" });
  if (p.stop_sign_confidence < 0.7)
    out.push({ code: "stop_low", label: "Low confidence on stop sign detections" });
  return out.slice(0, 3);
}

// --------------------------------------------------------------------------
// Flag-driven scoring (Atlas Checks integration)
// --------------------------------------------------------------------------

// Threshold tuned empirically on the SF/MV extracts so that ~30% of tiles fall
// below the default 0.8 cutoff and one high-severity flag alone moves a tile
// out of the "ready" bucket. The synthetic signal remains as fallback for
// tiles with no flags.
const READINESS_THRESHOLD = 300;

export interface FlagCounts {
  low: number;
  med: number;
  high: number;
  total: number;
}

export function countFlagsBySeverity(flags: readonly Flag[]): FlagCounts {
  const c: FlagCounts = { low: 0, med: 0, high: 0, total: 0 };
  for (const f of flags) {
    const s: Severity = f.properties.severity;
    c[s]++;
    c.total++;
  }
  return c;
}

export function weightedFlagSum(flags: readonly Flag[]): number {
  let s = 0;
  for (const f of flags) s += SEVERITY_WEIGHT[f.properties.severity];
  return s;
}

/**
 * Real, flag-derived readiness score for a tile. Caller is responsible for
 * filtering flags to those inside the tile bbox; this function is pure and
 * does not touch the tile's synthetic metrics.
 */
export function tileReadiness(_tile: TileProperties, flagsInBbox: readonly Flag[]): number {
  const sum = weightedFlagSum(flagsInBbox);
  const score = 1 - sum / READINESS_THRESHOLD;
  return Math.max(0, Math.min(1, score));
}

// Replace synthetic readiness with the flag-driven value, keeping the rest of
// the displayed metrics. Tiles with no flags keep their synthetic fallback so
// the page never goes uniformly green when validators turn up nothing.
export function tileWithFlagScore(tile: TileFeature, flagsInBbox: readonly Flag[]): TileFeature {
  const readiness = flagsInBbox.length === 0
    ? tile.properties.readiness_score
    : tileReadiness(tile.properties, flagsInBbox);
  return {
    ...tile,
    properties: {
      ...tile.properties,
      readiness_score: readiness,
      bucket: bucketOf(readiness),
    },
  };
}

export function bboxOfTile(tile: TileFeature): { west: number; south: number; east: number; north: number } {
  const ring = tile.geometry.coordinates[0];
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const c of ring) {
    if (c[0] < west) west = c[0];
    if (c[0] > east) east = c[0];
    if (c[1] < south) south = c[1];
    if (c[1] > north) north = c[1];
  }
  return { west, east, south, north };
}

export function flagCentroid(f: Flag): [number, number] | null {
  const g = f.geometry;
  if (!g) return null;
  if (g.type === "Point") return [g.coordinates[0], g.coordinates[1]];
  if (g.type === "LineString" && g.coordinates.length > 0) {
    let sx = 0;
    let sy = 0;
    for (const c of g.coordinates) {
      sx += c[0];
      sy += c[1];
    }
    return [sx / g.coordinates.length, sy / g.coordinates.length];
  }
  return null;
}

/**
 * Bucket flags by the tile they fall inside. Tiles form a uniform grid so we
 * compute each flag's cell directly rather than scanning every tile.
 */
export function indexFlagsByTile(
  tiles: TileCollection,
  flags: readonly Flag[],
): Map<string, Flag[]> {
  const out = new Map<string, Flag[]>();
  if (tiles.features.length === 0) return out;
  const first = bboxOfTile(tiles.features[0]);
  const stepLng = first.east - first.west;
  const stepLat = first.north - first.south;
  let originLng = Infinity;
  let originLat = Infinity;
  for (const t of tiles.features) {
    const b = bboxOfTile(t);
    if (b.west < originLng) originLng = b.west;
    if (b.south < originLat) originLat = b.south;
  }
  const byCell = new Map<string, string>();
  for (const t of tiles.features) {
    const b = bboxOfTile(t);
    const cx = Math.round((b.west - originLng) / stepLng);
    const cy = Math.round((b.south - originLat) / stepLat);
    byCell.set(`${cx},${cy}`, t.properties.tile_id);
  }
  for (const f of flags) {
    const p = flagCentroid(f);
    if (!p) continue;
    const cx = Math.floor((p[0] - originLng) / stepLng);
    const cy = Math.floor((p[1] - originLat) / stepLat);
    const tid = byCell.get(`${cx},${cy}`);
    if (!tid) continue;
    const arr = out.get(tid);
    if (arr) arr.push(f);
    else out.set(tid, [f]);
  }
  return out;
}
