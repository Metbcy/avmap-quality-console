import type { Feature, LineString, Position } from "geojson";
import type { Flag } from "../types";
import { haversineMeters } from "../geometry";

export type RoadFeature = Feature<LineString, { highway?: string | null; name?: string | null }>;

const MIN_SEGMENT_M = 2;

// Sub-2m segments are almost always digitization artifacts (double-tap edits,
// snap-then-undo, micro-noise from importers). They confuse downstream routing
// and side-of-road inference.
export function shortSegment(features: readonly RoadFeature[]): Flag[] {
  const out: Flag[] = [];
  for (const f of features) {
    const id = typeof f.id === "string" || typeof f.id === "number" ? String(f.id) : "";
    if (!id) continue;
    const coords: Position[] = f.geometry.coordinates;
    for (let i = 0; i + 1 < coords.length; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const d = haversineMeters(a, b);
      if (d < MIN_SEGMENT_M) {
        out.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
          properties: {
            rule_id: "AVMAP-SHORT-SEGMENT-004",
            severity: "low",
            description: `Segment of ${d.toFixed(2)}m on way ${id} is below the ${MIN_SEGMENT_M}m artifact threshold.`,
            source_feature_ids: [id],
          },
        });
      }
    }
  }
  return out;
}
