import { describe, it, expect } from "vitest";
import type { FeatureCollection } from "geojson";
import { CITIES, filterTilesToRoads, generateTiles } from "@/lib/scoring";

function makeRoads(coords: [number, number][][]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: coords.map((line) => ({
      type: "Feature",
      properties: { kind: "road", highway: "residential" },
      geometry: { type: "LineString", coordinates: line },
    })),
  };
}

describe("filterTilesToRoads", () => {
  it("returns input unchanged when roads feed is empty or missing", () => {
    const tiles = generateTiles("sf");
    expect(filterTilesToRoads(tiles, null).features.length).toBe(tiles.features.length);
    expect(
      filterTilesToRoads(tiles, { type: "FeatureCollection", features: [] }).features.length,
    ).toBe(tiles.features.length);
  });

  it("drops tiles that have no road vertices (open water)", () => {
    const tiles = generateTiles("sf");
    const c = CITIES.sf;
    // One single road vertex roughly in the middle of SF (downtown).
    const roads = makeRoads([[[-122.42, 37.77], [-122.418, 37.772]]]);
    const filtered = filterTilesToRoads(tiles, roads);
    expect(filtered.features.length).toBeGreaterThan(0);
    expect(filtered.features.length).toBeLessThan(tiles.features.length);
    // Every kept tile should be near the seed vertices, not way out west.
    const minLng = Math.min(...filtered.features.map((f) => f.geometry.coordinates[0][0][0]));
    expect(minLng).toBeGreaterThan(c.west);
  });

  it("keeps tiles a road LineString crosses, even bridge-like spans over water", () => {
    const tiles = generateTiles("sf");
    // Simulate the Bay Bridge: a line that crosses several tiles spanning open
    // water between downtown SF and Yerba Buena Island.
    const span: [number, number][] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      span.push([-122.39 + (-122.36 - -122.39) * t, 37.79 + (37.81 - 37.79) * t]);
    }
    const roads = makeRoads([span]);
    const filtered = filterTilesToRoads(tiles, roads);
    // At minimum the line should keep several distinct tiles along its path.
    expect(filtered.features.length).toBeGreaterThanOrEqual(3);
  });

  it("never returns an empty collection (safety fallback)", () => {
    const tiles = generateTiles("sf");
    // Roads totally outside the city bbox.
    const roads = makeRoads([[[0, 0], [1, 1]]]);
    const filtered = filterTilesToRoads(tiles, roads);
    expect(filtered.features.length).toBe(tiles.features.length);
  });
});
