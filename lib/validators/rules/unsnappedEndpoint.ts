import type { Position } from "geojson";
import type { Flag } from "../types";
import {
  keyOf,
  metersPerDegree,
  pointToSegmentDistSq,
} from "../geometry";
import type { RoadFeature } from "./shortSegment";

const SNAP_THRESHOLD_M = 5;

// Indexes interior segments of every way in a coarse lng/lat grid so each
// endpoint only checks nearby segments instead of all of them.
function buildSegmentIndex(features: readonly RoadFeature[], cellDeg: number) {
  const cells = new Map<string, { fid: string; segIdx: number }[]>();
  const push = (cx: number, cy: number, fid: string, segIdx: number) => {
    const k = `${cx},${cy}`;
    const arr = cells.get(k);
    if (arr) arr.push({ fid, segIdx });
    else cells.set(k, [{ fid, segIdx }]);
  };
  for (const f of features) {
    const id = typeof f.id === "string" || typeof f.id === "number" ? String(f.id) : "";
    if (!id) continue;
    const coords = f.geometry.coordinates;
    for (let i = 0; i + 1 < coords.length; i++) {
      const ax = coords[i][0];
      const ay = coords[i][1];
      const bx = coords[i + 1][0];
      const by = coords[i + 1][1];
      const minX = Math.min(ax, bx);
      const maxX = Math.max(ax, bx);
      const minY = Math.min(ay, by);
      const maxY = Math.max(ay, by);
      const x0 = Math.floor(minX / cellDeg);
      const x1 = Math.floor(maxX / cellDeg);
      const y0 = Math.floor(minY / cellDeg);
      const y1 = Math.floor(maxY / cellDeg);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          push(cx, cy, id, i);
        }
      }
    }
  }
  return cells;
}

// An endpoint that sits within 5m of another way's geometry but is not snapped
// to that way's vertex is the classic "dangling node" bug: routing graphs see
// a disconnect even though the road continues.
export function unsnappedEndpoint(features: readonly RoadFeature[]): Flag[] {
  if (features.length === 0) return [];

  let latSum = 0;
  let n = 0;
  for (const f of features) {
    for (const c of f.geometry.coordinates) {
      latSum += c[1];
      n++;
    }
  }
  const meanLat = n ? latSum / n : 0;
  const { mPerLat, mPerLng } = metersPerDegree(meanLat);

  // Choose a cell size slightly larger than the snap threshold so every
  // candidate within 5m falls in the endpoint cell or an immediate neighbor.
  const cellDeg = (SNAP_THRESHOLD_M * 2) / Math.max(mPerLat, mPerLng);
  const index = buildSegmentIndex(features, cellDeg);

  const out: Flag[] = [];
  const seen = new Set<string>();

  const featById = new Map<string, RoadFeature>();
  for (const f of features) {
    const id = typeof f.id === "string" || typeof f.id === "number" ? String(f.id) : "";
    if (id) featById.set(id, f);
  }

  for (const f of features) {
    const id = typeof f.id === "string" || typeof f.id === "number" ? String(f.id) : "";
    if (!id) continue;
    const coords = f.geometry.coordinates;
    if (coords.length < 2) continue;
    const endpoints: Position[] = [coords[0], coords[coords.length - 1]];

    for (const ep of endpoints) {
      const px = ep[0] * mPerLng;
      const py = ep[1] * mPerLat;
      const cx0 = Math.floor(ep[0] / cellDeg);
      const cy0 = Math.floor(ep[1] / cellDeg);

      let bestDist = Infinity;
      let bestOther: { fid: string; segIdx: number } | null = null;

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = index.get(`${cx0 + dx},${cy0 + dy}`);
          if (!bucket) continue;
          for (const cand of bucket) {
            if (cand.fid === id) continue;
            const other = featById.get(cand.fid);
            if (!other) continue;
            const a = other.geometry.coordinates[cand.segIdx];
            const b = other.geometry.coordinates[cand.segIdx + 1];

            // Skip if this endpoint is exactly equal to one of the candidate
            // segment's endpoints - in that case the ways already share a node.
            if (keyOf(ep) === keyOf(a) || keyOf(ep) === keyOf(b)) continue;

            const dSq = pointToSegmentDistSq(
              px,
              py,
              a[0] * mPerLng,
              a[1] * mPerLat,
              b[0] * mPerLng,
              b[1] * mPerLat,
            );
            if (dSq < bestDist) {
              bestDist = dSq;
              bestOther = cand;
            }
          }
        }
      }

      if (bestOther && bestDist < SNAP_THRESHOLD_M * SNAP_THRESHOLD_M) {
        const pairKey = id < bestOther.fid ? `${id}|${bestOther.fid}|${keyOf(ep)}` : `${bestOther.fid}|${id}|${keyOf(ep)}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const dist = Math.sqrt(bestDist);
        out.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: ep },
          properties: {
            rule_id: "AVMAP-UNSNAPPED-001",
            severity: "med",
            description: `Endpoint of way ${id} is ${dist.toFixed(2)}m from way ${bestOther.fid} but not snapped to it.`,
            source_feature_ids: [id, bestOther.fid],
          },
        });
      }
    }
  }

  return out;
}
