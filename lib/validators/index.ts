// runValidators(features): Flag[]
//
// Atlas-Checks-style rule runner over OSM highway LineStrings.
//
// Rules chosen for this dataset (highway=* LineString features tagged only
// with kind/highway/name - no oneway tag in the source extract):
//
//   AVMAP-UNSNAPPED-001  (med)  endpoint within 5m of another way but not
//                                snapped to a shared node.
//   AVMAP-SHARP-ANGLE-002 (low) interior vertex angle < 30deg outside any
//                                junction.
//   AVMAP-SHORT-SEGMENT-004 (low) consecutive vertices < 2m apart, almost
//                                always a digitization artifact.
//   AVMAP-DUPLICATE-WAY-005 (med) two ways with >= 80% mutual overlap inside
//                                a 4m buffer.
//
// AVMAP-ONEWAY-CONTRADICTION-003 is intentionally skipped because the local
// extract has no oneway tags to evaluate against.

import type { Feature, LineString } from "geojson";
import type { Flag } from "./types";
import { shortSegment, type RoadFeature } from "./rules/shortSegment";
import { sharpAngle } from "./rules/sharpAngle";
import { unsnappedEndpoint } from "./rules/unsnappedEndpoint";
import { duplicateWay } from "./rules/duplicateWay";

export type { Flag, FlagProperties, Severity, RuleId } from "./types";
export { SEVERITY_WEIGHT, SEVERITIES, RULE_IDS } from "./types";

function isRoad(
  f: Feature,
): f is Feature<LineString, { highway?: string | null; name?: string | null }> {
  return f.geometry?.type === "LineString";
}

export function runValidators(features: readonly Feature[]): Flag[] {
  const roads: RoadFeature[] = [];
  for (const f of features) {
    if (isRoad(f)) roads.push(f as RoadFeature);
  }
  return [
    ...shortSegment(roads),
    ...sharpAngle(roads),
    ...unsnappedEndpoint(roads),
    ...duplicateWay(roads),
  ];
}

export interface RuleMeta {
  id: import("./types").RuleId;
  title: string;
  severity: import("./types").Severity;
  description: string;
}

export const RULES: readonly RuleMeta[] = [
  {
    id: "AVMAP-UNSNAPPED-001",
    severity: "med",
    title: "Unsnapped endpoint",
    description: "Way endpoint sits within 5m of another way but is not snapped to a shared node.",
  },
  {
    id: "AVMAP-SHARP-ANGLE-002",
    severity: "low",
    title: "Sharp interior angle",
    description: "Interior vertex turns sharper than 30°, away from any junction.",
  },
  {
    id: "AVMAP-SHORT-SEGMENT-004",
    severity: "low",
    title: "Short segment",
    description: "Consecutive vertices less than 2m apart - likely a digitization artifact.",
  },
  {
    id: "AVMAP-DUPLICATE-WAY-005",
    severity: "med",
    title: "Duplicate way",
    description: "Two ways overlap by ≥80% within a 4m buffer.",
  },
] as const;
