// Deterministic seeded scoring for synthetic readiness tiles.
// All randomness is keyed on `<city>:<tile_id>` so reloads are stable.

import type { Feature, FeatureCollection, Polygon } from "geojson";

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
  // For MapLibre data-driven styling — numeric bucket: 0=red,1=yellow,2=green
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
 * Build a synthetic ~100–500m tile grid over a city's bbox.
 * Caps at MAX_AXIS x MAX_AXIS to stay performant.
 */
export function generateTiles(cityId: CityId): TileCollection {
  const city = CITIES[cityId];
  const latSpan = city.north - city.south;
  const lngSpan = city.east - city.west;

  // ~100m at city latitude.
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
  const now = Date.now();

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

      // Draw metrics with a slight skew toward higher confidence.
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
