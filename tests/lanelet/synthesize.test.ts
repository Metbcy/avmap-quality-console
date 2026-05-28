import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FeatureCollection, LineString, Point } from "geojson";
import { synthesizeLanelet } from "../../scripts/synthesize-lanelet";

const SF_BBOX = {
  west: -122.41,
  south: 37.78,
  east: -122.4,
  north: 37.79,
};

function loadFixture(): FeatureCollection<LineString | Point> {
  const path = resolve(process.cwd(), "public/data/sf.geojson");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as FeatureCollection<LineString | Point>;
}

describe("synthesizeLanelet", () => {
  const fc = loadFixture();
  const result = synthesizeLanelet(fc);

  it("emits at least 50 lanelet relations", () => {
    expect(result.laneletCount).toBeGreaterThanOrEqual(50);
    const relCount = (result.xml.match(/<relation\b/g) ?? []).length;
    expect(relCount).toBe(result.laneletCount);
  });

  it("starts with an XML declaration and a single <osm> root", () => {
    expect(result.xml.startsWith("<?xml")).toBe(true);
    const opens = (result.xml.match(/<osm\b/g) ?? []).length;
    const closes = (result.xml.match(/<\/osm>/g) ?? []).length;
    expect(opens).toBe(1);
    expect(closes).toBe(1);
  });

  it("emits every way with at least 2 node refs", () => {
    const wayBlocks = result.xml.match(/<way\b[\s\S]*?<\/way>/g) ?? [];
    expect(wayBlocks.length).toBeGreaterThan(0);
    for (const block of wayBlocks) {
      const nds = (block.match(/<nd\s/g) ?? []).length;
      expect(nds).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps every node inside the downtown SF bbox", () => {
    const nodeRe = /<node\b[^/>]*lat="([^"]+)"\s+lon="([^"]+)"/g;
    const slack = 0.0005;
    let count = 0;
    let m: RegExpExecArray | null;
    while ((m = nodeRe.exec(result.xml)) !== null) {
      const lat = parseFloat(m[1]);
      const lon = parseFloat(m[2]);
      expect(lat).toBeGreaterThanOrEqual(SF_BBOX.south - slack);
      expect(lat).toBeLessThanOrEqual(SF_BBOX.north + slack);
      expect(lon).toBeGreaterThanOrEqual(SF_BBOX.west - slack);
      expect(lon).toBeLessThanOrEqual(SF_BBOX.east + slack);
      count++;
    }
    expect(count).toBe(result.nodeCount);
  });

  it("tags every lanelet relation with the expected metadata", () => {
    const relBlocks = result.xml.match(/<relation\b[\s\S]*?<\/relation>/g) ?? [];
    expect(relBlocks.length).toBeGreaterThanOrEqual(50);
    for (const block of relBlocks) {
      expect(block).toContain('k="type" v="lanelet"');
      expect(block).toContain('k="subtype" v="road"');
      expect(block).toContain('role="left"');
      expect(block).toContain('role="right"');
      expect(block).toContain('k="speed_limit" v="40 mph"');
      expect(block).toContain('k="participant:vehicle" v="yes"');
    }
  });
});
