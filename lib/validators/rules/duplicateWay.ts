import type { Position } from "geojson";
import type { Flag } from "../types";
import { centroidOf, haversineMeters, metersPerDegree, pointToSegmentDistSq } from "../geometry";
import type { RoadFeature } from "./shortSegment";

const BUFFER_M = 4;
const OVERLAP_THRESHOLD = 0.8;
const SAMPLE_STEP_M = 5;

interface IndexedWay {
  id: string;
  coords: Position[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bbox(coords: Position[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of coords) {
    if (c[0] < minX) minX = c[0];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[1] > maxY) maxY = c[1];
  }
  return { minX, minY, maxX, maxY };
}

// Samples evenly along the polyline `coords` at roughly `stepM` metre spacing
// and returns the fraction that lie within `bufferM` metres of any segment in
// `other`. Used in both directions to detect mutual overlap.
function coveredFraction(
  coords: Position[],
  other: Position[],
  stepM: number,
  bufferM: number,
  mPerLat: number,
  mPerLng: number,
): number {
  let total = 0;
  let hits = 0;
  const bufSq = bufferM * bufferM;

  for (let i = 0; i + 1 < coords.length; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = haversineMeters(a, b);
    const samples = Math.max(1, Math.ceil(segLen / stepM));
    for (let s = 0; s < samples; s++) {
      const t = (s + 0.5) / samples;
      const px = (a[0] + t * (b[0] - a[0])) * mPerLng;
      const py = (a[1] + t * (b[1] - a[1])) * mPerLat;
      total++;
      let near = false;
      for (let j = 0; j + 1 < other.length; j++) {
        const oa = other[j];
        const ob = other[j + 1];
        const dSq = pointToSegmentDistSq(
          px,
          py,
          oa[0] * mPerLng,
          oa[1] * mPerLat,
          ob[0] * mPerLng,
          ob[1] * mPerLat,
        );
        if (dSq <= bufSq) {
          near = true;
          break;
        }
      }
      if (near) hits++;
    }
  }
  return total === 0 ? 0 : hits / total;
}

// Two ways with mostly-overlapping geometry usually means a leftover import
// from a re-tracing edit. Either is fine on its own, but having both inflates
// length statistics and breaks routing alternatives.
export function duplicateWay(features: readonly RoadFeature[]): Flag[] {
  const indexed: IndexedWay[] = [];
  for (const f of features) {
    const id = typeof f.id === "string" || typeof f.id === "number" ? String(f.id) : "";
    if (!id) continue;
    const coords = f.geometry.coordinates;
    if (coords.length < 2) continue;
    indexed.push({ id, coords, ...bbox(coords) });
  }

  if (indexed.length === 0) return [];

  // Use the dataset centroid latitude for the local-metre projection. Cheap and
  // accurate enough at city scales.
  let latSum = 0;
  let nLat = 0;
  for (const w of indexed) {
    latSum += (w.minY + w.maxY) / 2;
    nLat++;
  }
  const meanLat = latSum / Math.max(1, nLat);
  const { mPerLat, mPerLng } = metersPerDegree(meanLat);

  // Bbox-bucket using a cell sized to the buffer so candidates with disjoint
  // bboxes (after expansion) are never compared.
  const cellDeg = (BUFFER_M * 4) / Math.max(mPerLat, mPerLng);
  const buckets = new Map<string, number[]>();
  const pad = BUFFER_M / Math.min(mPerLat, mPerLng);
  for (let i = 0; i < indexed.length; i++) {
    const w = indexed[i];
    const x0 = Math.floor((w.minX - pad) / cellDeg);
    const x1 = Math.floor((w.maxX + pad) / cellDeg);
    const y0 = Math.floor((w.minY - pad) / cellDeg);
    const y1 = Math.floor((w.maxY + pad) / cellDeg);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = `${cx},${cy}`;
        const arr = buckets.get(k);
        if (arr) arr.push(i);
        else buckets.set(k, [i]);
      }
    }
  }

  const seenPairs = new Set<string>();
  const out: Flag[] = [];

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    for (let a = 0; a < bucket.length; a++) {
      for (let b = a + 1; b < bucket.length; b++) {
        const i = bucket[a];
        const j = bucket[b];
        const wi = indexed[i];
        const wj = indexed[j];
        const pairKey = wi.id < wj.id ? `${wi.id}|${wj.id}` : `${wj.id}|${wi.id}`;
        if (seenPairs.has(pairKey)) continue;

        // Cheap bbox-overlap reject before doing the O(n*m) sample check.
        if (
          wi.maxX + pad < wj.minX ||
          wj.maxX + pad < wi.minX ||
          wi.maxY + pad < wj.minY ||
          wj.maxY + pad < wi.minY
        ) {
          seenPairs.add(pairKey);
          continue;
        }

        seenPairs.add(pairKey);

        const fwd = coveredFraction(wi.coords, wj.coords, SAMPLE_STEP_M, BUFFER_M, mPerLat, mPerLng);
        if (fwd < OVERLAP_THRESHOLD) continue;
        const rev = coveredFraction(wj.coords, wi.coords, SAMPLE_STEP_M, BUFFER_M, mPerLat, mPerLng);
        if (rev < OVERLAP_THRESHOLD) continue;

        const centroid = centroidOf(wi.coords);
        out.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: centroid },
          properties: {
            rule_id: "AVMAP-DUPLICATE-WAY-005",
            severity: "med",
            description: `Ways ${wi.id} and ${wj.id} overlap by ${(Math.min(fwd, rev) * 100).toFixed(0)}% within ${BUFFER_M}m.`,
            source_feature_ids: [wi.id, wj.id],
          },
        });
      }
    }
  }

  return out;
}
