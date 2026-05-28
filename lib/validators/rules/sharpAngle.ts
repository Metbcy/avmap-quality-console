import type { Flag } from "../types";
import { angleAtVertexDeg, keyOf } from "../geometry";
import type { RoadFeature } from "./shortSegment";

const SHARP_ANGLE_DEG = 30;

// Real intersections legitimately have sharp angles where ways meet (think of
// a slip ramp or a Y-junction), so we ignore vertices that are shared with
// any other way. We only complain about kinks inside a single way.
export function sharpAngle(features: readonly RoadFeature[]): Flag[] {
  const vertexUse = new Map<string, number>();
  for (const f of features) {
    for (const c of f.geometry.coordinates) {
      const k = keyOf(c);
      vertexUse.set(k, (vertexUse.get(k) ?? 0) + 1);
    }
  }

  const out: Flag[] = [];
  for (const f of features) {
    const id = typeof f.id === "string" || typeof f.id === "number" ? String(f.id) : "";
    if (!id) continue;
    const coords = f.geometry.coordinates;
    for (let i = 1; i + 1 < coords.length; i++) {
      const b = coords[i];
      if ((vertexUse.get(keyOf(b)) ?? 0) > 1) continue;
      const angle = angleAtVertexDeg(coords[i - 1], b, coords[i + 1]);
      if (angle < SHARP_ANGLE_DEG) {
        out.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: b },
          properties: {
            rule_id: "AVMAP-SHARP-ANGLE-002",
            severity: "low",
            description: `Interior turn of ${angle.toFixed(1)}° on way ${id} is sharper than ${SHARP_ANGLE_DEG}° and not at a junction.`,
            source_feature_ids: [id],
          },
        });
      }
    }
  }
  return out;
}
