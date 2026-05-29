import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FeatureCollection, LineString, Point } from "geojson";
import { synthesizeLanelet } from "../../scripts/synthesize-lanelet";

const SF_BBOX = {
  west: -122.42,
  south: 37.775,
  east: -122.395,
  north: 37.795,
};

function loadFixture(): FeatureCollection<LineString | Point> {
  const path = resolve(process.cwd(), "public/data/sf.geojson");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as FeatureCollection<LineString | Point>;
}

describe("synthesizeLanelet", () => {
  const fc = loadFixture();
  const result = synthesizeLanelet(fc);

  it("emits at least 150 lanelet relations plus regulatory elements", () => {
    expect(result.laneletCount).toBeGreaterThanOrEqual(150);
    const relCount = (result.xml.match(/<relation\b/g) ?? []).length;
    // Lanelet relations + regulatory element relations
    expect(relCount).toBe(result.laneletCount + result.regulatoryElementCount);
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

  it("tags every lanelet relation with required Lanelet2 metadata", () => {
    const relBlocks = result.xml.match(/<relation\b[\s\S]*?<\/relation>/g) ?? [];
    const laneletBlocks = relBlocks.filter((b) =>
      b.includes('k="type" v="lanelet"'),
    );
    expect(laneletBlocks.length).toBe(result.laneletCount);
    for (const block of laneletBlocks) {
      expect(block).toMatch(/k="subtype" v="(road|bicycle_lane|walkway|crosswalk)"/);
      expect(block).toContain('role="left"');
      expect(block).toContain('role="right"');
      expect(block).toMatch(/k="speed_limit" v="\d+ mph"/);
      expect(block).toMatch(/k="one_way" v="(yes|no)"/);
      expect(block).toMatch(/k="location" v="(urban|nonurban)"/);
    }
  });

  it("emits varied lanelet subtypes, speed limits, and one_way values", () => {
    const relBlocks = result.xml.match(/<relation\b[\s\S]*?<\/relation>/g) ?? [];
    const laneletBlocks = relBlocks.filter((b) =>
      b.includes('k="type" v="lanelet"'),
    );
    const subtypes = new Set<string>();
    const speeds = new Set<string>();
    const oneWays = new Set<string>();
    for (const block of laneletBlocks) {
      const s = block.match(/k="subtype" v="([^"]+)"/);
      if (s) subtypes.add(s[1]);
      const sp = block.match(/k="speed_limit" v="([^"]+)"/);
      if (sp) speeds.add(sp[1]);
      const ow = block.match(/k="one_way" v="([^"]+)"/);
      if (ow) oneWays.add(ow[1]);
    }
    expect(subtypes.size).toBeGreaterThanOrEqual(2);
    expect(speeds.size).toBeGreaterThanOrEqual(3);
    expect(oneWays.size).toBe(2);
  });

  it("emits varied boundary line subtypes", () => {
    const wayBlocks = result.xml.match(/<way\b[\s\S]*?<\/way>/g) ?? [];
    const lineTypes = new Set<string>();
    for (const block of wayBlocks) {
      const t = block.match(/k="type" v="([^"]+)"/);
      if (t) lineTypes.add(t[1]);
    }
    // We expect at least line_thin plus one of curbstone / virtual
    expect(lineTypes.has("line_thin")).toBe(true);
    expect(lineTypes.size).toBeGreaterThanOrEqual(2);
  });

  it("emits stop_line and traffic_light regulatory elements", () => {
    expect(result.stopLineCount).toBeGreaterThan(0);
    expect(result.trafficLightCount).toBeGreaterThan(0);
    expect(result.regulatoryElementCount).toBe(
      result.stopLineCount + result.trafficLightCount,
    );
    const relBlocks = result.xml.match(/<relation\b[\s\S]*?<\/relation>/g) ?? [];
    const stopLines = relBlocks.filter((b) =>
      b.includes('k="subtype" v="stop_line"'),
    );
    const lights = relBlocks.filter((b) =>
      b.includes('k="subtype" v="traffic_light"'),
    );
    expect(stopLines.length).toBe(result.stopLineCount);
    expect(lights.length).toBe(result.trafficLightCount);
    // Each traffic_light regulatory element wires both refers and ref_line
    for (const block of lights) {
      expect(block).toContain('role="refers"');
      expect(block).toContain('role="ref_line"');
    }
  });
});
