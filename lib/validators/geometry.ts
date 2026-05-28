import type { Position } from "geojson";

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

export function haversineMeters(a: Position, b: Position): number {
  const lat1 = a[1] * DEG_TO_RAD;
  const lat2 = b[1] * DEG_TO_RAD;
  const dLat = (b[1] - a[1]) * DEG_TO_RAD;
  const dLon = (b[0] - a[0]) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Approximate degrees-per-meter at a given latitude. Cheap enough to use as a
// local planar projection for short distances (a few hundred metres at most),
// which is what every rule below operates on.
export function metersPerDegree(lat: number): { mPerLat: number; mPerLng: number } {
  const latRad = lat * DEG_TO_RAD;
  return {
    mPerLat: 111_132.92 - 559.82 * Math.cos(2 * latRad),
    mPerLng: 111_412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad),
  };
}

// Returns the smaller turning angle in degrees at vertex `b` between segments
// (a->b) and (b->c). 180 means perfectly straight, 0 means doubling back.
export function angleAtVertexDeg(a: Position, b: Position, c: Position): number {
  const ux = a[0] - b[0];
  const uy = a[1] - b[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu === 0 || lv === 0) return 180;
  let cos = (ux * vx + uy * vy) / (lu * lv);
  if (cos > 1) cos = 1;
  if (cos < -1) cos = -1;
  return (Math.acos(cos) * 180) / Math.PI;
}

// Squared distance from point p to segment (a, b) in a planar coordinate space.
// Used by the unsnapped-endpoint rule after projecting to local metres.
export function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

export function centroidOf(coords: Position[]): Position {
  let sx = 0;
  let sy = 0;
  for (const c of coords) {
    sx += c[0];
    sy += c[1];
  }
  const n = coords.length || 1;
  return [sx / n, sy / n];
}

// Stable 6-decimal rounding for endpoint hashing. ~11cm at the equator, which
// is well below any tolerance any of the rules care about.
export function keyOf(pos: Position): string {
  return `${pos[0].toFixed(6)},${pos[1].toFixed(6)}`;
}
