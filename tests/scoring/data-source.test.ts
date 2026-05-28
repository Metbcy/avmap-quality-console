import { describe, it, expect } from "vitest";
import type { Feature, FeatureCollection } from "geojson";
import { tileWithFlagScore, generateTiles, indexFlagsByTile } from "@/lib/scoring";
import { runValidators, type Flag } from "@/lib/validators";

// The toggle between OSM and Overture means scoring must produce a valid
// number in [0, 1] regardless of which source's flags feed it. Both branches
// of the toggle use the same `tileWithFlagScore` path; this test exercises
// that path with two distinct synthesised inputs.

function osmStyleFeatures(): Feature[] {
  return [
    {
      type: "Feature",
      id: "way/1",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.5, 37.75],
          [-122.4999, 37.7501],
        ],
      },
      properties: { kind: "road", highway: "residential", name: "Short Way" },
    },
    {
      type: "Feature",
      id: "way/2",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.45, 37.75],
          [-122.45, 37.76],
        ],
      },
      properties: { kind: "road", highway: "primary", name: "Main St" },
    },
  ];
}

function overtureStyleFeatures(): Feature[] {
  return [
    {
      type: "Feature",
      id: "overture/segment/1",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.5, 37.75],
          [-122.4999, 37.7501],
        ],
      },
      properties: {
        kind: "road",
        class: "residential",
        subclass: "residential",
        highway: "residential",
        lanes: 2,
        maxspeed: 40,
        oneway: "no",
        source: "overture",
      },
    },
    {
      type: "Feature",
      id: "overture/segment/2",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.45, 37.75],
          [-122.45, 37.76],
        ],
      },
      properties: {
        kind: "road",
        class: "primary",
        subclass: "primary",
        highway: "primary",
        lanes: 2,
        maxspeed: 65,
        oneway: "no",
        source: "overture",
      },
    },
  ];
}

function score(features: Feature[]): number {
  const flags = runValidators(features) as Flag[];
  const tiles = generateTiles("sf");
  const flagsByTile = indexFlagsByTile(tiles, flags);
  // Pick a tile with at least one flag if any exist, otherwise the first.
  const first = tiles.features.find((t) =>
    (flagsByTile.get(t.properties.tile_id) ?? []).length > 0,
  ) ?? tiles.features[0];
  const scored = tileWithFlagScore(
    first,
    flagsByTile.get(first.properties.tile_id) ?? [],
  );
  return scored.properties.readiness_score;
}

describe("scoring across data sources", () => {
  it("produces a finite score in [0, 1] from OSM-style features", () => {
    const s = score(osmStyleFeatures());
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("produces a finite score in [0, 1] from Overture-style features", () => {
    const s = score(overtureStyleFeatures());
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("accepts both source shapes through runValidators without error", () => {
    const a: FeatureCollection = { type: "FeatureCollection", features: osmStyleFeatures() };
    const b: FeatureCollection = { type: "FeatureCollection", features: overtureStyleFeatures() };
    expect(() => runValidators(a.features)).not.toThrow();
    expect(() => runValidators(b.features)).not.toThrow();
  });
});
