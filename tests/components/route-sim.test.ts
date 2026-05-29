import { describe, it, expect } from "vitest";
import { haversineKm, sampleLine, countHandoffs, type LngLat } from "@/lib/routeSim";
import type { TileCollection, TileFeature } from "@/lib/scoring";
import type { Flag } from "@/lib/validators";

// ------------------------------------------------------------------ helpers

function makeTile(
  west: number,
  south: number,
  east: number,
  north: number,
  readiness: number,
  id?: string,
): TileFeature {
  return {
    type: "Feature",
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
    properties: {
      tile_id: id ?? `T-${south}-${west}`,
      city: "sf",
      lat: (south + north) / 2,
      lng: (west + east) / 2,
      lane_marking_confidence: 0.8,
      construction_flag: false,
      sensor_divergence_score: 0.2,
      stop_sign_confidence: 0.8,
      readiness_score: readiness,
      last_validated_at: "2026-05-29T00:00:00.000Z",
      bucket: readiness >= 0.9 ? 2 : readiness >= 0.75 ? 1 : 0,
    },
  };
}

function tiles(...features: TileFeature[]): TileCollection {
  return { type: "FeatureCollection", features };
}

function highFlag(lng: number, lat: number): Flag {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {
      rule_id: "AVMAP-UNSNAPPED-001",
      severity: "high",
      description: "test",
      source_feature_ids: [],
    },
  };
}

function lowFlag(lng: number, lat: number): Flag {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {
      rule_id: "AVMAP-SHORT-SEGMENT-004",
      severity: "low",
      description: "test",
      source_feature_ids: [],
    },
  };
}

// 2-tile horizontal grid: T1 covers [0,0]-[1,1], T2 covers [1,0]-[2,1].
const T1 = makeTile(0, 0, 1, 1, 0.5, "T1"); // below threshold=0.8
const T2 = makeTile(1, 0, 2, 1, 0.95, "T2"); // above threshold=0.8
const twoTileGrid = tiles(T1, T2);

// ------------------------------------------------------------------ haversineKm

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    const p: LngLat = { lng: -122.4, lat: 37.77 };
    expect(haversineKm(p, p)).toBeCloseTo(0);
  });

  it("gives ~111 km per degree of latitude at equator", () => {
    const a: LngLat = { lng: 0, lat: 0 };
    const b: LngLat = { lng: 0, lat: 1 };
    expect(haversineKm(a, b)).toBeCloseTo(111, 0);
  });
});

// ------------------------------------------------------------------ sampleLine

describe("sampleLine", () => {
  const a: LngLat = { lng: 0, lat: 0 };
  const b: LngLat = { lng: 2, lat: 2 };

  it("returns empty array for n=0", () => {
    expect(sampleLine(a, b, 0)).toEqual([]);
  });

  it("returns the midpoint for n=1", () => {
    const pts = sampleLine(a, b, 1);
    expect(pts).toHaveLength(1);
    expect(pts[0].lng).toBeCloseTo(1);
    expect(pts[0].lat).toBeCloseTo(1);
  });

  it("returns endpoints for n=2", () => {
    const pts = sampleLine(a, b, 2);
    expect(pts[0]).toEqual(a);
    expect(pts[1]).toEqual(b);
  });

  it("returns n evenly spaced points including both endpoints", () => {
    const pts = sampleLine(a, b, 5);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual(a);
    expect(pts[4]).toEqual(b);
    expect(pts[2].lng).toBeCloseTo(1);
  });
});

// ------------------------------------------------------------------ countHandoffs

describe("countHandoffs", () => {
  const threshold = 0.8;

  it("returns 0 for empty tile collection", () => {
    const samples = sampleLine({ lng: 0.5, lat: 0.5 }, { lng: 1.5, lat: 0.5 }, 10);
    const result = countHandoffs(samples, tiles(), [], threshold);
    expect(result.count).toBe(0);
    expect(result.tileIds.size).toBe(0);
  });

  it("returns 0 when all tiles are above the readiness threshold", () => {
    const readyGrid = tiles(
      makeTile(0, 0, 1, 1, 0.95, "A"),
      makeTile(1, 0, 2, 1, 0.92, "B"),
    );
    const samples = sampleLine({ lng: 0.1, lat: 0.5 }, { lng: 1.9, lat: 0.5 }, 100);
    expect(countHandoffs(samples, readyGrid, [], threshold).count).toBe(0);
  });

  it("counts a tile below threshold as a handoff", () => {
    const samples = sampleLine({ lng: 0.1, lat: 0.5 }, { lng: 0.9, lat: 0.5 }, 100);
    const result = countHandoffs(samples, twoTileGrid, [], threshold);
    expect(result.count).toBe(1);
    expect(result.tileIds.has("T1")).toBe(true);
  });

  it("counts both tiles when both are below threshold", () => {
    const bothLow = tiles(
      makeTile(0, 0, 1, 1, 0.5, "A"),
      makeTile(1, 0, 2, 1, 0.6, "B"),
    );
    const samples = sampleLine({ lng: 0.1, lat: 0.5 }, { lng: 1.9, lat: 0.5 }, 100);
    expect(countHandoffs(samples, bothLow, [], threshold).count).toBe(2);
  });

  it("deduplicates: same tile crossed by all samples counts as one handoff", () => {
    // Route stays entirely within T1 (the low-readiness tile).
    const samples = sampleLine({ lng: 0.1, lat: 0.5 }, { lng: 0.9, lat: 0.5 }, 100);
    const result = countHandoffs(samples, twoTileGrid, [], threshold);
    expect(result.count).toBe(1);
  });

  it("does not count a tile traversed multiple times more than once", () => {
    // Route crosses T1 (low) then T2 (high), both samples hit T1 twice effectively.
    // Use only 3 samples to hit T1, gap, T1 - not possible with straight line but
    // dedup is verified by checking count === 1 even with many samples in T1.
    const many = sampleLine({ lng: 0.01, lat: 0.5 }, { lng: 0.99, lat: 0.5 }, 200);
    const result = countHandoffs(many, twoTileGrid, [], threshold);
    expect(result.count).toBe(1); // only T1 is a handoff, counted once
  });

  it("treats a tile with a high-severity flag as a handoff regardless of readiness score", () => {
    const highReadyGrid = tiles(
      makeTile(0, 0, 1, 1, 0.95, "T-ready"),
    );
    const flag = highFlag(0.5, 0.5); // inside T-ready
    const samples = sampleLine({ lng: 0.1, lat: 0.5 }, { lng: 0.9, lat: 0.5 }, 20);
    const result = countHandoffs(samples, highReadyGrid, [flag], threshold);
    expect(result.count).toBe(1);
    expect(result.tileIds.has("T-ready")).toBe(true);
  });

  it("does not count a tile with only low-severity flags when readiness is sufficient", () => {
    const highReadyGrid = tiles(
      makeTile(0, 0, 1, 1, 0.95, "T-ready"),
    );
    const flag = lowFlag(0.5, 0.5);
    const samples = sampleLine({ lng: 0.1, lat: 0.5 }, { lng: 0.9, lat: 0.5 }, 20);
    expect(countHandoffs(samples, highReadyGrid, [flag], threshold).count).toBe(0);
  });

  it("only counts tiles that the route actually passes through", () => {
    // Route stays in T2 (high readiness). T1 (low readiness) is not visited.
    const samples = sampleLine({ lng: 1.1, lat: 0.5 }, { lng: 1.9, lat: 0.5 }, 100);
    const result = countHandoffs(samples, twoTileGrid, [], threshold);
    expect(result.count).toBe(0);
  });
});
