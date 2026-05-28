import type { Feature, Geometry } from "geojson";

export const SEVERITIES = ["low", "med", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RULE_IDS = [
  "AVMAP-UNSNAPPED-001",
  "AVMAP-SHARP-ANGLE-002",
  "AVMAP-SHORT-SEGMENT-004",
  "AVMAP-DUPLICATE-WAY-005",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export interface FlagProperties {
  rule_id: RuleId;
  severity: Severity;
  description: string;
  source_feature_ids: string[];
}

export type Flag = Feature<Geometry, FlagProperties>;

// Severity weights used by tile readiness scoring. Tuned so that one "high"
// flag dominates a tile while several "low" flags are needed to matter.
export const SEVERITY_WEIGHT: Readonly<Record<Severity, number>> = {
  low: 1,
  med: 3,
  high: 7,
} as const;
