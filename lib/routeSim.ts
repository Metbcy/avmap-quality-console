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

/** Total kilometers along an ordered polyline. */
export function polylineLengthKm(points: LngLat[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(points[i - 1], points[i]);
  }
  return total;
}

interface TileIndex {
  originLng: number;
  originLat: number;
  stepLng: number;
  stepLat: number;
  cols: number;
  rows: number;
  byCell: Map<string, TileFeature>;
  cellOf: Map<string, { cx: number; cy: number }>; // tile_id -> grid coords
}

function buildTileIndex(tiles: TileCollection): TileIndex | null {
  if (tiles.features.length === 0) return null;
  const first = bboxOfTile(tiles.features[0]);
  const stepLng = first.east - first.west;
  const stepLat = first.north - first.south;
  if (stepLng <= 0 || stepLat <= 0) return null;

  let originLng = Infinity;
  let originLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const t of tiles.features) {
    const b = bboxOfTile(t);
    if (b.west < originLng) originLng = b.west;
    if (b.south < originLat) originLat = b.south;
    if (b.east > maxLng) maxLng = b.east;
    if (b.north > maxLat) maxLat = b.north;
  }

  const cols = Math.max(1, Math.round((maxLng - originLng) / stepLng));
  const rows = Math.max(1, Math.round((maxLat - originLat) / stepLat));

  const byCell = new Map<string, TileFeature>();
  const cellOf = new Map<string, { cx: number; cy: number }>();
  for (const t of tiles.features) {
    const b = bboxOfTile(t);
    const cx = Math.round((b.west - originLng) / stepLng);
    const cy = Math.round((b.south - originLat) / stepLat);
    byCell.set(`${cx},${cy}`, t);
    cellOf.set(t.properties.tile_id, { cx, cy });
  }

  return { originLng, originLat, stepLng, stepLat, cols, rows, byCell, cellOf };
}

function lookupTile(lng: number, lat: number, idx: TileIndex): TileFeature | null {
  const cx = Math.floor((lng - idx.originLng) / idx.stepLng);
  const cy = Math.floor((lat - idx.originLat) / idx.stepLat);
  return idx.byCell.get(`${cx},${cy}`) ?? null;
}

function tileCenter(tile: TileFeature): LngLat {
  const b = bboxOfTile(tile);
  return { lng: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 };
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

  const highFlagTileIds = collectHighFlagTileIds(flags, idx);

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

function collectHighFlagTileIds(flags: Flag[], idx: TileIndex): Set<string> {
  const ids = new Set<string>();
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
    if (t) ids.add(t.properties.tile_id);
  }
  return ids;
}

// ---------------------------------------------------------- readiness-aware planner

export interface PlannedRoute {
  /** Ordered polyline of LngLat points (starts at A, ends at B). */
  path: LngLat[];
  /** Ordered tile_ids the planner steps through (includes A's and B's tiles). */
  tileSequence: string[];
  /** Total length of the planned polyline in km. */
  distanceKm: number;
  /** Tiles that are below threshold OR carry a high-severity flag, counted along the planned route. */
  handoffCount: number;
  handoffTileIds: ReadonlySet<string>;
  /** Red tiles (bucket 0) the straight A->B line would have crossed but the planner avoided. */
  redTilesAvoided: number;
  /** True when the planner used the grid (false = degenerate fallback to straight line). */
  usedGrid: boolean;
}

/**
 * Per-tile traversal cost multiplier. Green is cheap, yellow moderate, red expensive
 * (but still finite — the planner will cross red as a last resort if no path around exists).
 * A high-severity flag adds an additive penalty on top.
 */
function tileTraversalCost(tile: TileFeature, hasHighFlag: boolean): number {
  const base =
    tile.properties.bucket === 2 ? 1.0 : // green
    tile.properties.bucket === 1 ? 2.8 : // yellow
    12.0;                                 // red
  return base + (hasHighFlag ? 4.0 : 0);
}

/** Tiny binary-heap priority queue (min-heap by `key`). */
class MinHeap<T> {
  private heap: Array<{ key: number; val: T }> = [];
  size(): number { return this.heap.length; }
  push(key: number, val: T): void {
    this.heap.push({ key, val });
    this.bubbleUp(this.heap.length - 1);
  }
  pop(): { key: number; val: T } | undefined {
    const n = this.heap.length;
    if (n === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (n > 1) { this.heap[0] = last; this.sinkDown(0); }
    return top;
  }
  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].key < this.heap[parent].key) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }
  private sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.heap[l].key < this.heap[smallest].key) smallest = l;
      if (r < n && this.heap[r].key < this.heap[smallest].key) smallest = r;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

/**
 * Plan a readiness-aware route from A to B using 8-connected Dijkstra over the tile grid.
 *
 * The planner snaps A and B to their containing tiles, then searches for the lowest-cost
 * path of tile centers where edge cost = geographic distance * avg(traversal cost of the
 * two adjacent tiles). Red tiles are crossable but expensive; the path will detour through
 * green corridors when the detour is shorter than the red penalty.
 *
 * Falls back to a straight A->B line when the grid is empty, when either endpoint is
 * outside the grid, or when A and B share the same tile.
 */
export function planRoute(
  a: LngLat,
  b: LngLat,
  tiles: TileCollection,
  flags: Flag[],
  threshold: number,
): PlannedRoute {
  const straightDistance = haversineKm(a, b);
  const idx = buildTileIndex(tiles);
  if (!idx) {
    return {
      path: [a, b],
      tileSequence: [],
      distanceKm: straightDistance,
      handoffCount: 0,
      handoffTileIds: new Set(),
      redTilesAvoided: 0,
      usedGrid: false,
    };
  }

  const highFlagTileIds = collectHighFlagTileIds(flags, idx);
  const tileA = lookupTile(a.lng, a.lat, idx);
  const tileB = lookupTile(b.lng, b.lat, idx);

  if (!tileA || !tileB || tileA.properties.tile_id === tileB.properties.tile_id) {
    return {
      path: [a, b],
      tileSequence: tileA ? [tileA.properties.tile_id] : [],
      distanceKm: straightDistance,
      handoffCount: countHandoffs(sampleLine(a, b, 50), tiles, flags, threshold).count,
      handoffTileIds: countHandoffs(sampleLine(a, b, 50), tiles, flags, threshold).tileIds,
      redTilesAvoided: 0,
      usedGrid: false,
    };
  }

  const startCell = idx.cellOf.get(tileA.properties.tile_id)!;
  const goalCell = idx.cellOf.get(tileB.properties.tile_id)!;
  const startKey = `${startCell.cx},${startCell.cy}`;
  const goalKey = `${goalCell.cx},${goalCell.cy}`;

  // Dijkstra over the 8-connected tile grid.
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  dist.set(startKey, 0);
  prev.set(startKey, null);

  const heap = new MinHeap<string>();
  heap.push(0, startKey);

  const neighbors: Array<[number, number]> = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];

  let found = false;
  while (heap.size() > 0) {
    const cur = heap.pop()!;
    if (cur.key > (dist.get(cur.val) ?? Infinity)) continue;
    if (cur.val === goalKey) { found = true; break; }
    const [cxStr, cyStr] = cur.val.split(",");
    const cx = Number(cxStr);
    const cy = Number(cyStr);
    const curTile = idx.byCell.get(cur.val);
    if (!curTile) continue;
    const curCenter = tileCenter(curTile);
    const curCost = tileTraversalCost(curTile, highFlagTileIds.has(curTile.properties.tile_id));

    for (const [dx, dy] of neighbors) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nKey = `${nx},${ny}`;
      const nTile = idx.byCell.get(nKey);
      if (!nTile) continue;
      const nCenter = tileCenter(nTile);
      const nCost = tileTraversalCost(nTile, highFlagTileIds.has(nTile.properties.tile_id));
      const edge = haversineKm(curCenter, nCenter) * ((curCost + nCost) / 2);
      const alt = cur.key + edge;
      if (alt < (dist.get(nKey) ?? Infinity)) {
        dist.set(nKey, alt);
        prev.set(nKey, cur.val);
        heap.push(alt, nKey);
      }
    }
  }

  if (!found) {
    return {
      path: [a, b],
      tileSequence: [],
      distanceKm: straightDistance,
      handoffCount: countHandoffs(sampleLine(a, b, 50), tiles, flags, threshold).count,
      handoffTileIds: countHandoffs(sampleLine(a, b, 50), tiles, flags, threshold).tileIds,
      redTilesAvoided: 0,
      usedGrid: false,
    };
  }

  // Reconstruct path of tile cells from goal back to start.
  const cellPath: string[] = [];
  let cur: string | null | undefined = goalKey;
  while (cur) {
    cellPath.unshift(cur);
    cur = prev.get(cur) ?? null;
  }

  const tileSequence: string[] = [];
  const polyline: LngLat[] = [a];
  for (let i = 0; i < cellPath.length; i++) {
    const t = idx.byCell.get(cellPath[i])!;
    tileSequence.push(t.properties.tile_id);
    // Skip the entry tile center (A is inside it) and the exit tile center (B is inside it)
    // for a cleaner polyline; we add A and B explicitly as endpoints.
    if (i === 0 || i === cellPath.length - 1) continue;
    polyline.push(tileCenter(t));
  }
  polyline.push(b);

  // Compute planned-route handoffs along the polyline (sample densely so we hit every tile crossed).
  const segSamples: LngLat[] = [];
  for (let i = 1; i < polyline.length; i++) {
    segSamples.push(...sampleLine(polyline[i - 1], polyline[i], 20));
  }
  const planned = countHandoffs(segSamples, tiles, flags, threshold);

  // Red tiles the straight line crossed that the planner avoided.
  const straightSamples = sampleLine(a, b, 100);
  const straightTilesCrossed = new Set<string>();
  for (const pt of straightSamples) {
    const t = lookupTile(pt.lng, pt.lat, idx);
    if (t) straightTilesCrossed.add(t.properties.tile_id);
  }
  const plannedTilesSet = new Set(tileSequence);
  let redTilesAvoided = 0;
  for (const sid of straightTilesCrossed) {
    if (plannedTilesSet.has(sid)) continue;
    const cell = idx.cellOf.get(sid);
    if (!cell) continue;
    const t = idx.byCell.get(`${cell.cx},${cell.cy}`);
    if (t && t.properties.bucket === 0) redTilesAvoided++;
  }

  return {
    path: polyline,
    tileSequence,
    distanceKm: polylineLengthKm(polyline),
    handoffCount: planned.count,
    handoffTileIds: planned.tileIds,
    redTilesAvoided,
    usedGrid: true,
  };
}
