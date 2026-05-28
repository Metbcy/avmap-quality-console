/**
 * Synthesizes a small Lanelet2 OSM-XML sample from the SF road network in
 * public/data/sf.geojson.
 *
 * Why: the upstream Lanelet2 mapping_example.osm is centered on Karlsruhe and
 * looks out of place in an SF / Mountain View demo. Real production HD-map
 * tiles are sensor-derived and proprietary, so we cannot ship one. As a
 * stand-in we take ~50 short OSM road centerlines around downtown SF and emit
 * a structurally valid Lanelet2 file by:
 *   - duplicating each centerline twice (left and right boundary)
 *   - offsetting each boundary by +/-2m perpendicular to the local tangent,
 *     using a flat-earth approximation at the SF reference latitude
 *   - wrapping the two ways in a relation of type=lanelet subtype=road
 *
 * The output is geometry only: lane widths, speed limits and one_way tags are
 * uniform placeholders, not survey data. Run with:
 *   npx tsx scripts/synthesize-lanelet.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  FeatureCollection,
  LineString,
  Point,
  Position,
} from "geojson";

type Bbox = { west: number; south: number; east: number; north: number };

const DOWNTOWN_SF: Bbox = {
  west: -122.41,
  south: 37.78,
  east: -122.4,
  north: 37.79,
};

const REF_LAT_DEG = 37.785;
const METERS_PER_DEG_LAT = 111_320;
const METERS_PER_DEG_LON =
  METERS_PER_DEG_LAT * Math.cos((REF_LAT_DEG * Math.PI) / 180);
const BOUNDARY_OFFSET_M = 2;
const TARGET_LANELET_COUNT = 50;
const MAX_VERTICES_PER_WAY = 12;
const ID_START = 10_000_000;

type RoadSegment = {
  sourceId: string | number | undefined;
  highway: string;
  name: string | null;
  coords: Position[];
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function withinBbox([lon, lat]: Position, b: Bbox): boolean {
  return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
}

function pickSegments(
  fc: FeatureCollection<LineString | Point>,
  bbox: Bbox,
  target: number,
): RoadSegment[] {
  const out: RoadSegment[] = [];
  for (const f of fc.features) {
    if (out.length >= target) break;
    if (f.geometry.type !== "LineString") continue;
    const coords = f.geometry.coordinates;
    if (coords.length < 2) continue;
    if (!coords.every((c) => withinBbox(c, bbox))) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (props.kind !== "road") continue;
    const trimmed =
      coords.length > MAX_VERTICES_PER_WAY
        ? coords.slice(0, MAX_VERTICES_PER_WAY)
        : coords;
    out.push({
      sourceId: typeof f.id === "string" || typeof f.id === "number" ? f.id : undefined,
      highway: typeof props.highway === "string" ? props.highway : "residential",
      name: typeof props.name === "string" ? props.name : null,
      coords: trimmed,
    });
  }
  return out;
}

function offsetPolyline(
  coords: Position[],
  offsetMeters: number,
): Position[] {
  const n = coords.length;
  const out: Position[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = coords[Math.max(0, i - 1)];
    const next = coords[Math.min(n - 1, i + 1)];
    const dxM = (next[0] - prev[0]) * METERS_PER_DEG_LON;
    const dyM = (next[1] - prev[1]) * METERS_PER_DEG_LAT;
    const len = Math.hypot(dxM, dyM);
    if (len === 0) {
      out[i] = [coords[i][0], coords[i][1]];
      continue;
    }
    const nxM = -dyM / len;
    const nyM = dxM / len;
    const shiftXM = nxM * offsetMeters;
    const shiftYM = nyM * offsetMeters;
    const shiftLon = shiftXM / METERS_PER_DEG_LON;
    const shiftLat = shiftYM / METERS_PER_DEG_LAT;
    out[i] = [coords[i][0] + shiftLon, coords[i][1] + shiftLat];
  }
  return out;
}

type XmlNode = { id: number; lon: number; lat: number };
type XmlWay = { id: number; nodeRefs: number[]; tags: Record<string, string> };
type XmlRelation = {
  id: number;
  members: { type: "way" | "node" | "relation"; ref: number; role: string }[];
  tags: Record<string, string>;
};

function buildXml(
  nodes: XmlNode[],
  ways: XmlWay[],
  relations: XmlRelation[],
  bbox: Bbox,
): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<osm version="0.6" generator="avmap-synthesize-lanelet" upload="false">',
  );
  lines.push(
    `  <bounds minlat="${bbox.south}" minlon="${bbox.west}" maxlat="${bbox.north}" maxlon="${bbox.east}"/>`,
  );
  for (const n of nodes) {
    lines.push(
      `  <node id="${n.id}" visible="true" version="1" lat="${n.lat.toFixed(7)}" lon="${n.lon.toFixed(7)}"/>`,
    );
  }
  for (const w of ways) {
    lines.push(`  <way id="${w.id}" visible="true" version="1">`);
    for (const ref of w.nodeRefs) {
      lines.push(`    <nd ref="${ref}"/>`);
    }
    for (const [k, v] of Object.entries(w.tags)) {
      lines.push(`    <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`);
    }
    lines.push("  </way>");
  }
  for (const r of relations) {
    lines.push(`  <relation id="${r.id}" visible="true" version="1">`);
    for (const m of r.members) {
      lines.push(
        `    <member type="${m.type}" ref="${m.ref}" role="${escapeXml(m.role)}"/>`,
      );
    }
    for (const [k, v] of Object.entries(r.tags)) {
      lines.push(`    <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`);
    }
    lines.push("  </relation>");
  }
  lines.push("</osm>");
  return lines.join("\n");
}

export type SynthesisResult = {
  xml: string;
  nodeCount: number;
  wayCount: number;
  laneletCount: number;
};

export function synthesizeLanelet(
  fc: FeatureCollection<LineString | Point>,
  bbox: Bbox = DOWNTOWN_SF,
  target: number = TARGET_LANELET_COUNT,
): SynthesisResult {
  const segments = pickSegments(fc, bbox, target);

  const nodes: XmlNode[] = [];
  const ways: XmlWay[] = [];
  const relations: XmlRelation[] = [];

  let nextId = ID_START;
  const allocId = (): number => nextId++;

  for (const seg of segments) {
    const left = offsetPolyline(seg.coords, -BOUNDARY_OFFSET_M);
    const right = offsetPolyline(seg.coords, BOUNDARY_OFFSET_M);

    const leftNodeIds: number[] = [];
    for (const [lon, lat] of left) {
      const id = allocId();
      nodes.push({ id, lon, lat });
      leftNodeIds.push(id);
    }
    const rightNodeIds: number[] = [];
    for (const [lon, lat] of right) {
      const id = allocId();
      nodes.push({ id, lon, lat });
      rightNodeIds.push(id);
    }

    const leftWayId = allocId();
    ways.push({
      id: leftWayId,
      nodeRefs: leftNodeIds,
      tags: { type: "line_thin", subtype: "solid" },
    });
    const rightWayId = allocId();
    ways.push({
      id: rightWayId,
      nodeRefs: rightNodeIds,
      tags: { type: "line_thin", subtype: "solid" },
    });

    const relTags: Record<string, string> = {
      type: "lanelet",
      subtype: "road",
      location: "urban",
      one_way: "no",
      "participant:vehicle": "yes",
      speed_limit: "40 mph",
    };
    if (seg.name) relTags.name = seg.name;
    if (seg.highway) relTags.road_type = seg.highway;

    relations.push({
      id: allocId(),
      members: [
        { type: "way", ref: leftWayId, role: "left" },
        { type: "way", ref: rightWayId, role: "right" },
      ],
      tags: relTags,
    });
  }

  const xml = buildXml(nodes, ways, relations, bbox);
  return {
    xml,
    nodeCount: nodes.length,
    wayCount: ways.length,
    laneletCount: relations.length,
  };
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const inputPath = resolve(cwd, "public/data/sf.geojson");
  const outputPath = resolve(cwd, "public/data/lanelet2_sf_synthetic.osm");

  const raw = await readFile(inputPath, "utf8");
  const fc = JSON.parse(raw) as FeatureCollection<LineString | Point>;

  const result = synthesizeLanelet(fc);
  await writeFile(outputPath, result.xml, "utf8");

  console.log(
    `wrote ${outputPath}: ${result.laneletCount} lanelets, ${result.wayCount} ways, ${result.nodeCount} nodes`,
  );

  if (result.laneletCount < TARGET_LANELET_COUNT) {
    console.warn(
      `warning: only ${result.laneletCount} lanelets emitted (target ${TARGET_LANELET_COUNT}); widen bbox or relax filter`,
    );
  }
}

const isDirect =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /synthesize-lanelet\.(ts|js|mjs|cjs)$/.test(process.argv[1]);

if (isDirect) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
