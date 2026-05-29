import { describe, it, expect } from "vitest";
import {
  haversineKm,
  sampleLine,
  countHandoffs,
  planRoute,
  polylineLengthKm,
  type LngLat,
} from "@/lib/routeSim";
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

// Build an NxM uniform grid where readiness is given by a (cx,cy) -> number function.
function gridFromFn(
  cols: number,
  rows: number,
  readinessAt: (cx: number, cy: number) => number,
): TileCollection {
  const features: TileFeature[] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      features.push(makeTile(cx, cy, cx + 1, cy + 1, readinessAt(cx, cy), `T-${cx}-${cy}`));
    }
  }
  return tiles(...features);
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

// ------------------------------------------------------------------ polylineLengthKm

describe("polylineLengthKm", () => {
  it("returns 0 for <2 points", () => {
    expect(polylineLengthKm([])).toBe(0);
    expect(polylineLengthKm([{ lng: 0, lat: 0 }])).toBe(0);
  });

  it("sums segment lengths", () => {
    const pts: LngLat[] = [
      { lng: 0, lat: 0 },
      { lng: 0, lat: 1 },
      { lng: 0, lat: 2 },
    ];
    expect(polylineLengthKm(pts)).toBeCloseTo(222, 0);
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
    const samples = sampleLine({ lng: 0.1, lat: 0.5 }, { lng: 0.9, lat: 0.5 }, 100);
    const result = countHandoffs(samples, twoTileGrid, [], threshold);
    expect(result.count).toBe(1);
  });

  it("does not count a tile traversed multiple times more than once", () => {
    const many = sampleLine({ lng: 0.01, lat: 0.5 }, { lng: 0.99, lat: 0.5 }, 200);
    const result = countHandoffs(many, twoTileGrid, [], threshold);
    expect(result.count).toBe(1);
  });

  it("treats a tile with a high-severity flag as a handoff regardless of readiness score", () => {
    const highReadyGrid = tiles(makeTile(0, 0, 1, 1, 0.95, "T-ready"));
    const flag = highFlag(0.5, 0.5);
    const samples = sampleLine({ lng: 0.1, lat: 0.5 }, { lng: 0.9, lat: 0.5 }, 20);
    const result = countHandoffs(samples, highReadyGrid, [flag], threshold);
    expect(result.count).toBe(1);
    expect(result.tileIds.has("T-ready")).toBe(true);
  });

  it("does not count a tile with only low-severity flags when readiness is sufficient", () => {
    const highReadyGrid = tiles(makeTile(0, 0, 1, 1, 0.95, "T-ready"));
    const flag = lowFlag(0.5, 0.5);
    const samples = sampleLine({ lng: 0.1, lat: 0.5 }, { lng: 0.9, lat: 0.5 }, 20);
    expect(countHandoffs(samples, highReadyGrid, [flag], threshold).count).toBe(0);
  });

  it("only counts tiles that the route actually passes through", () => {
    const samples = sampleLine({ lng: 1.1, lat: 0.5 }, { lng: 1.9, lat: 0.5 }, 100);
    const result = countHandoffs(samples, twoTileGrid, [], threshold);
    expect(result.count).toBe(0);
  });
});

// ------------------------------------------------------------------ planRoute

describe("planRoute", () => {
  const threshold = 0.8;

  it("falls back to a straight line when the grid is empty", () => {
    const a: LngLat = { lng: 0.1, lat: 0.1 };
    const b: LngLat = { lng: 0.9, lat: 0.9 };
    const route = planRoute(a, b, tiles(), [], threshold);
    expect(route.usedGrid).toBe(false);
    expect(route.path).toEqual([a, b]);
    expect(route.tileSequence).toEqual([]);
  });

  it("falls back to a straight line when A and B share the same tile", () => {
    const a: LngLat = { lng: 0.2, lat: 0.5 };
    const b: LngLat = { lng: 0.8, lat: 0.5 };
    const route = planRoute(a, b, twoTileGrid, [], threshold);
    expect(route.usedGrid).toBe(false);
    expect(route.path).toEqual([a, b]);
  });

  it("plans a path of tile centers between distinct tiles", () => {
    // 3-wide all-green grid: A in T-0-0, B in T-2-0. Planner crosses middle tile.
    const grid = gridFromFn(3, 1, () => 0.95);
    const route = planRoute(
      { lng: 0.5, lat: 0.5 },
      { lng: 2.5, lat: 0.5 },
      grid,
      [],
      threshold,
    );
    expect(route.usedGrid).toBe(true);
    expect(route.tileSequence).toEqual(["T-0-0", "T-1-0", "T-2-0"]);
    expect(route.handoffCount).toBe(0);
  });

  it("detours around a red tile when a green corridor is available", () => {
    // 3x3 grid, all green except the center tile (1,1) which is red.
    //   green green green
    //   green RED   green
    //   green green green
    // A bottom-left, B top-right. Naive diagonal crosses the red center.
    // Planner should detour around it.
    const grid = gridFromFn(3, 3, (cx, cy) => (cx === 1 && cy === 1 ? 0.4 : 0.95));
    const route = planRoute(
      { lng: 0.5, lat: 0.5 }, // tile (0,0)
      { lng: 2.5, lat: 2.5 }, // tile (2,2)
      grid,
      [],
      threshold,
    );
    expect(route.usedGrid).toBe(true);
    expect(route.tileSequence).not.toContain("T-1-1"); // avoids red center
    expect(route.tileSequence[0]).toBe("T-0-0");
    expect(route.tileSequence[route.tileSequence.length - 1]).toBe("T-2-2");
    expect(route.handoffCount).toBe(0);
    expect(route.redTilesAvoided).toBeGreaterThanOrEqual(1);
  });

  it("crosses a red tile when no green path exists (red as last resort)", () => {
    // 3x1 grid, middle tile red, no other path possible.
    const grid = gridFromFn(3, 1, (cx) => (cx === 1 ? 0.4 : 0.95));
    const route = planRoute(
      { lng: 0.5, lat: 0.5 },
      { lng: 2.5, lat: 0.5 },
      grid,
      [],
      threshold,
    );
    expect(route.usedGrid).toBe(true);
    expect(route.tileSequence).toContain("T-1-0");
    expect(route.handoffCount).toBe(1); // forced through the red tile
  });

  it("avoids tiles carrying a high-severity flag even when readiness is high", () => {
    // 3x1 all-green, but middle tile has a high-severity flag.
    const grid = gridFromFn(3, 1, () => 0.95);
    // Detour requires a second row — make it a 3x2 grid with the alternate row clean.
    const wider = gridFromFn(3, 2, () => 0.95);
    const flag = highFlag(1.5, 0.5); // inside T-1-0
    const route = planRoute(
      { lng: 0.5, lat: 0.5 },
      { lng: 2.5, lat: 0.5 },
      wider,
      [flag],
      threshold,
    );
    expect(route.usedGrid).toBe(true);
    expect(route.tileSequence).not.toContain("T-1-0");
    expect(route.handoffCount).toBe(0);
    void grid;
  });

  it("returns a polyline starting at A and ending at B", () => {
    const grid = gridFromFn(3, 1, () => 0.95);
    const a: LngLat = { lng: 0.2, lat: 0.7 };
    const b: LngLat = { lng: 2.8, lat: 0.3 };
    const route = planRoute(a, b, grid, [], threshold);
    expect(route.path[0]).toEqual(a);
    expect(route.path[route.path.length - 1]).toEqual(b);
    expect(route.distanceKm).toBeGreaterThan(0);
  });
});
