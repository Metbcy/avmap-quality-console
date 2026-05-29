import { bboxOfTile, type TileCollection, type TileFeature } from "./scoring";
import type { Flag } from "./validators";

export interface LngLat {
  lng: number;
  lat: number;
}

export interface HandoffResult {
  count: number;
  tileIds: ReadonlySet<string>;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Sample n evenly-spaced points along the straight line from a to b (inclusive). */
export function sampleLine(a: LngLat, b: LngLat, n: number): LngLat[] {
  if (n <= 0) return [];
  if (n === 1) return [{ lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 }];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { lng: a.lng + t * (b.lng - a.lng), lat: a.lat + t * (b.lat - a.lat) };
  });
}

interface TileIndex {
  originLng: number;
  originLat: number;
  stepLng: number;
  stepLat: number;
  byCell: Map<string, TileFeature>;
}

function buildTileIndex(tiles: TileCollection): TileIndex | null {
  if (tiles.features.length === 0) return null;
  const first = bboxOfTile(tiles.features[0]);
  const stepLng = first.east - first.west;
  const stepLat = first.north - first.south;
  if (stepLng <= 0 || stepLat <= 0) return null;

  let originLng = Infinity;
  let originLat = Infinity;
  for (const t of tiles.features) {
    const b = bboxOfTile(t);
    if (b.west < originLng) originLng = b.west;
    if (b.south < originLat) originLat = b.south;
  }

  const byCell = new Map<string, TileFeature>();
  for (const t of tiles.features) {
    const b = bboxOfTile(t);
    const cx = Math.round((b.west - originLng) / stepLng);
    const cy = Math.round((b.south - originLat) / stepLat);
    byCell.set(`${cx},${cy}`, t);
  }

  return { originLng, originLat, stepLng, stepLat, byCell };
}

function lookupTile(lng: number, lat: number, idx: TileIndex): TileFeature | null {
  const cx = Math.floor((lng - idx.originLng) / idx.stepLng);
  const cy = Math.floor((lat - idx.originLat) / idx.stepLat);
  return idx.byCell.get(`${cx},${cy}`) ?? null;
}

/**
 * Count unique "handoff" tiles along the sampled route.
 * A tile counts as a handoff if readiness_score < threshold OR
 * it contains at least one high-severity flag. Same tile crossed
 * multiple times still counts as one handoff.
 */
export function countHandoffs(
  samples: LngLat[],
  tiles: TileCollection,
  flags: Flag[],
  threshold: number,
): HandoffResult {
  const idx = buildTileIndex(tiles);
  if (!idx) return { count: 0, tileIds: new Set() };

  // Pre-compute which tiles have at least one high-severity flag.
  const highFlagTileIds = new Set<string>();
  for (const f of flags) {
    if (f.properties.severity !== "high") continue;
    const g = f.geometry;
    let lng: number | null = null;
    let lat: number | null = null;
    if (g.type === "Point") {
      [lng, lat] = g.coordinates as [number, number];
    } else if (g.type === "LineString" && g.coordinates.length > 0) {
      const mid = g.coordinates[Math.floor(g.coordinates.length / 2)] as [number, number];
      [lng, lat] = mid;
    }
    if (lng === null || lat === null) continue;
    const t = lookupTile(lng, lat, idx);
    if (t) highFlagTileIds.add(t.properties.tile_id);
  }

  const handoffTileIds = new Set<string>();
  for (const pt of samples) {
    const t = lookupTile(pt.lng, pt.lat, idx);
    if (!t) continue;
    const tid = t.properties.tile_id;
    if (handoffTileIds.has(tid)) continue;
    if (t.properties.readiness_score < threshold || highFlagTileIds.has(tid)) {
      handoffTileIds.add(tid);
    }
  }

  return { count: handoffTileIds.size, tileIds: handoffTileIds };
}
