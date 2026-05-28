import { describe, it, expect } from "vitest";
import type { Feature, FeatureCollection } from "geojson";
import { rollupTagsForTile } from "@/lib/osm/tag-rollup";
import type { TileFeature } from "@/lib/scoring";

function tile(west: number, south: number, east: number, north: number): TileFeature {
  return {
    type: "Feature",
    properties: {
      tile_id: "T-000-000",
      city: "sf",
      lat: (south + north) / 2,
      lng: (west + east) / 2,
      lane_marking_confidence: 1,
      construction_flag: false,
      sensor_divergence_score: 0,
      stop_sign_confidence: 1,
      readiness_score: 1,
      last_validated_at: new Date().toISOString(),
      bucket: 2,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };
}

function line(coords: [number, number][], props: Record<string, unknown>): Feature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: props,
  };
}

function point(c: [number, number], props: Record<string, unknown>): Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: c },
    properties: props,
  };
}

describe("rollupTagsForTile", () => {
  const t = tile(0, 0, 1, 1);

  it("returns empty rollup for no roads", () => {
    const r = rollupTagsForTile(t, { type: "FeatureCollection", features: [] });
    expect(r.way_count).toBe(0);
    expect(r.lanes.present).toBe(0);
    expect(r.oneway_pct).toBeNull();
    expect(r.signals).toEqual({ traffic_signals: 0, stop: 0, give_way: 0 });
  });

  it("rolls up lanes, maxspeed, oneway and node kinds for ways inside the tile bbox", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        line([[0.1, 0.1], [0.2, 0.2]], { lanes: 2, maxspeed: 50, oneway: "no" }),
        line([[0.3, 0.3], [0.4, 0.4]], { lanes: 4, maxspeed: 70, oneway: "yes" }),
        line([[0.5, 0.5], [0.6, 0.6]], { lanes: 2, maxspeed: "30 mph", oneway: "yes" }),
        line([[0.7, 0.7], [0.8, 0.8]], { lanes: "3", oneway: "yes" }),
        // Outside bbox - must be ignored.
        line([[5, 5], [6, 6]], { lanes: 10, maxspeed: 200, oneway: "yes" }),
        point([0.1, 0.1], { kind: "traffic_signals" }),
        point([0.2, 0.2], { kind: "stop" }),
        point([0.3, 0.3], { kind: "stop" }),
        point([0.4, 0.4], { kind: "give_way" }),
        // Outside bbox.
        point([9, 9], { kind: "traffic_signals" }),
      ],
    };
    const r = rollupTagsForTile(t, fc);
    expect(r.way_count).toBe(4);
    expect(r.lanes.present).toBe(4);
    expect(r.lanes.missing).toBe(0);
    expect(r.lanes.p10).toBeLessThanOrEqual(2);
    expect(r.lanes.p50).toBeGreaterThanOrEqual(2);
    expect(r.lanes.p90).toBeGreaterThanOrEqual(3);
    // 3 of 4 ways have maxspeed set (the last is missing).
    expect(r.maxspeed.present).toBe(3);
    expect(r.maxspeed.missing).toBe(1);
    // "30 mph" -> ~48 km/h, so p50 sits in the 48-70 range.
    expect(r.maxspeed.p50! >= 48 && r.maxspeed.p50! <= 70).toBe(true);
    // 3 of 4 ways are oneway=yes -> 75%.
    expect(r.oneway_pct).toBeCloseTo(0.75, 5);
    expect(r.oneway_present).toBe(4);
    expect(r.signals).toEqual({ traffic_signals: 1, stop: 2, give_way: 1 });
  });

  it("treats missing tags as missing rather than zero", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        line([[0.1, 0.1], [0.2, 0.2]], { highway: "residential" }),
        line([[0.3, 0.3], [0.4, 0.4]], { highway: "residential" }),
      ],
    };
    const r = rollupTagsForTile(t, fc);
    expect(r.way_count).toBe(2);
    expect(r.lanes.present).toBe(0);
    expect(r.lanes.missing).toBe(2);
    expect(r.maxspeed.present).toBe(0);
    expect(r.oneway_pct).toBeNull();
    expect(r.oneway_present).toBe(0);
  });
});
