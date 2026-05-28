import { describe, it, expect } from "vitest";
import type { Feature, LineString } from "geojson";
import { runValidators } from "../index";
import { shortSegment } from "../rules/shortSegment";
import { sharpAngle } from "../rules/sharpAngle";
import { unsnappedEndpoint } from "../rules/unsnappedEndpoint";
import { duplicateWay } from "../rules/duplicateWay";

type Road = Feature<LineString, { highway?: string | null; name?: string | null }>;

function road(id: string, coords: [number, number][]): Road {
  return {
    type: "Feature",
    id,
    geometry: { type: "LineString", coordinates: coords },
    properties: { highway: "residential", name: null },
  };
}

// One degree of longitude at lat 37.4 is roughly 88_500m; 1e-5 deg ~= 0.88m.
const M = 1 / 111_000;

describe("AVMAP-SHORT-SEGMENT-004", () => {
  it("flags sub-2m consecutive vertices", () => {
    const r = road("way/1", [
      [-122.0, 37.4],
      [-122.0 + 1 * M, 37.4],
    ]);
    expect(shortSegment([r])).toHaveLength(1);
  });

  it("does not flag a normal 10m segment", () => {
    const r = road("way/2", [
      [-122.0, 37.4],
      [-122.0 + 12 * M, 37.4],
    ]);
    expect(shortSegment([r])).toHaveLength(0);
  });
});

describe("AVMAP-SHARP-ANGLE-002", () => {
  it("flags a near-doubling-back vertex inside a way", () => {
    const r = road("way/3", [
      [-122.0, 37.4],
      [-122.0 + 50 * M, 37.4],
      [-122.0 + 50 * M, 37.4 + 50 * M],
      [-122.0 + 49 * M, 37.4 - 50 * M],
    ]);
    const flags = sharpAngle([r]);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0].properties.rule_id).toBe("AVMAP-SHARP-ANGLE-002");
  });

  it("ignores a straight polyline", () => {
    const r = road("way/4", [
      [-122.0, 37.4],
      [-122.0 + 50 * M, 37.4],
      [-122.0 + 100 * M, 37.4],
    ]);
    expect(sharpAngle([r])).toHaveLength(0);
  });

  it("skips sharp angles at junction vertices", () => {
    const junction: [number, number] = [-122.0 + 50 * M, 37.4];
    const a = road("way/5", [
      [-122.0, 37.4],
      junction,
      [-122.0 + 49 * M, 37.4 - 50 * M],
    ]);
    const b = road("way/6", [
      junction,
      [-122.0 + 50 * M, 37.4 + 50 * M],
    ]);
    expect(sharpAngle([a, b])).toHaveLength(0);
  });
});

describe("AVMAP-UNSNAPPED-001", () => {
  it("flags an endpoint floating ~3m off another way", () => {
    const a = road("way/7", [
      [-122.0, 37.4],
      [-122.0 + 100 * M, 37.4],
    ]);
    // Endpoint 3m south of a's mid-segment, not sharing any vertex.
    const b = road("way/8", [
      [-122.0 + 50 * M, 37.4 - 3 * M],
      [-122.0 + 50 * M, 37.4 - 40 * M],
    ]);
    const flags = unsnappedEndpoint([a, b]);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0].properties.rule_id).toBe("AVMAP-UNSNAPPED-001");
  });

  it("does not flag a properly snapped junction", () => {
    const shared: [number, number] = [-122.0 + 50 * M, 37.4];
    const a = road("way/9", [
      [-122.0, 37.4],
      shared,
      [-122.0 + 100 * M, 37.4],
    ]);
    const b = road("way/10", [
      shared,
      [-122.0 + 50 * M, 37.4 - 40 * M],
    ]);
    expect(unsnappedEndpoint([a, b])).toHaveLength(0);
  });

  it("does not flag endpoints far away from any other way", () => {
    const a = road("way/11", [
      [-122.0, 37.4],
      [-122.0 + 100 * M, 37.4],
    ]);
    const b = road("way/12", [
      [-121.5, 37.0],
      [-121.5 + 100 * M, 37.0],
    ]);
    expect(unsnappedEndpoint([a, b])).toHaveLength(0);
  });
});

describe("AVMAP-DUPLICATE-WAY-005", () => {
  it("flags two near-identical ways", () => {
    const a = road("way/13", [
      [-122.0, 37.4],
      [-122.0 + 50 * M, 37.4],
      [-122.0 + 100 * M, 37.4],
    ]);
    const b = road("way/14", [
      [-122.0, 37.4 + 1 * M],
      [-122.0 + 50 * M, 37.4 + 1 * M],
      [-122.0 + 100 * M, 37.4 + 1 * M],
    ]);
    const flags = duplicateWay([a, b]);
    expect(flags.length).toBe(1);
    expect(flags[0].properties.rule_id).toBe("AVMAP-DUPLICATE-WAY-005");
  });

  it("does not flag crossing but non-overlapping ways", () => {
    const a = road("way/15", [
      [-122.0, 37.4],
      [-122.0 + 100 * M, 37.4],
    ]);
    const b = road("way/16", [
      [-122.0 + 50 * M, 37.4 - 50 * M],
      [-122.0 + 50 * M, 37.4 + 50 * M],
    ]);
    expect(duplicateWay([a, b])).toHaveLength(0);
  });
});

describe("runValidators integration", () => {
  it("returns flags conforming to the FlagProperties shape", () => {
    const r = road("way/17", [
      [-122.0, 37.4],
      [-122.0 + 1 * M, 37.4],
    ]);
    const flags = runValidators([r]);
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) {
      expect(f.properties.rule_id).toMatch(/^AVMAP-/);
      expect(["low", "med", "high"]).toContain(f.properties.severity);
      expect(typeof f.properties.description).toBe("string");
      expect(Array.isArray(f.properties.source_feature_ids)).toBe(true);
    }
  });
});
