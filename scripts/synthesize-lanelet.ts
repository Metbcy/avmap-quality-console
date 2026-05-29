/**
 * Synthesizes a richer Lanelet2 OSM-XML sample from the SF road network in
 * public/data/sf.geojson.
 *
 * Why: the upstream Lanelet2 mapping_example.osm is centered on Karlsruhe and
 * looks out of place in an SF / Mountain View demo. Real production HD-map
 * tiles are sensor-derived and proprietary, so we cannot ship one. As a
 * stand-in we take ~150 short OSM road centerlines around downtown SF and emit
 * a structurally valid Lanelet2 file by:
 *   - duplicating each centerline twice (left and right boundary)
 *   - offsetting each boundary by +/-2m perpendicular to the local tangent,
 *     using a flat-earth approximation at the SF reference latitude
 *   - wrapping the two ways in a relation of type=lanelet
 *   - varying lanelet subtype (road / bicycle_lane / crosswalk) from the
 *     source highway class
 *   - varying boundary line subtype (solid / dashed / virtual / curbstone)
 *   - deriving speed_limit and one_way from highway class (the source OSM
 *     extract has no oneway tags, so this is heuristic, not survey data)
 *   - synthesizing stop_line regulatory_elements at the end of ~30% of
 *     lanelets, and traffic_light regulatory_elements on ~half of those,
 *     wired with ref_line and refers roles per Lanelet2 spec
 *
 * Numbers below the spec geometry (line offsets, fixed 2m lane width) are
 * placeholders. Tags are synthesized from OSM highway class; they're
 * plausible but not survey-grade. Run with:
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
  west: -122.42,
  south: 37.775,
  east: -122.395,
  north: 37.795,
};

const REF_LAT_DEG = 37.785;
const METERS_PER_DEG_LAT = 111_320;
const METERS_PER_DEG_LON =
  METERS_PER_DEG_LAT * Math.cos((REF_LAT_DEG * Math.PI) / 180);
const BOUNDARY_OFFSET_M = 2;
const STOP_LINE_HALF_WIDTH_M = 2.5;
const TRAFFIC_LIGHT_HALF_WIDTH_M = 1.5;
const TARGET_LANELET_COUNT = 500;
const MAX_VERTICES_PER_WAY = 12;
const ID_START = 10_000_000;

// Deterministic hash so we get stable variety across re-runs without RNG.
function hash(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff;
}

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

// Eligible road kinds in roughly priority order. We pick a mix so the output
// gets variety in subtype / speed / one_way.
const ELIGIBLE_HIGHWAYS = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "unclassified",
  "living_street",
  "service",
  "motorway_link",
  "trunk_link",
  "primary_link",
  "secondary_link",
  "tertiary_link",
  // pedestrian / bike networks -> we map these to non-road lanelet subtypes
  "footway",
  "pedestrian",
  "cycleway",
]);

function pickSegments(
  fc: FeatureCollection<LineString | Point>,
  bbox: Bbox,
  target: number,
): RoadSegment[] {
  const out: RoadSegment[] = [];
  // Pull up to ~4x target candidates first, then take a stratified slice so
  // we don't end up with 150 footways at the front of the list.
  const buckets = new Map<string, RoadSegment[]>();
  for (const f of fc.features) {
    if (f.geometry.type !== "LineString") continue;
    const coords = f.geometry.coordinates;
    if (coords.length < 2) continue;
    if (!coords.every((c) => withinBbox(c, bbox))) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (props.kind !== "road") continue;
    const highway = typeof props.highway === "string" ? props.highway : "residential";
    if (!ELIGIBLE_HIGHWAYS.has(highway)) continue;
    const trimmed =
      coords.length > MAX_VERTICES_PER_WAY
        ? coords.slice(0, MAX_VERTICES_PER_WAY)
        : coords;
    const seg: RoadSegment = {
      sourceId:
        typeof f.id === "string" || typeof f.id === "number" ? f.id : undefined,
      highway,
      name: typeof props.name === "string" ? props.name : null,
      coords: trimmed,
    };
    const arr = buckets.get(highway) ?? [];
    arr.push(seg);
    buckets.set(highway, arr);
  }

  // Round-robin across highway classes until we hit target. This guarantees
  // class variety regardless of how the input is ordered.
  const classOrder = [
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "residential",
    "service",
    "unclassified",
    "living_street",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
    "cycleway",
    "footway",
    "pedestrian",
  ];
  const cursors = new Map<string, number>();
  let progress = true;
  while (out.length < target && progress) {
    progress = false;
    for (const cls of classOrder) {
      if (out.length >= target) break;
      const arr = buckets.get(cls);
      if (!arr) continue;
      const i = cursors.get(cls) ?? 0;
      if (i >= arr.length) continue;
      out.push(arr[i]);
      cursors.set(cls, i + 1);
      progress = true;
    }
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

// Perpendicular line segment of total length 2*halfWidthM, centered at
// coords[anchorIdx], oriented perpendicular to the local tangent.
function perpendicularBar(
  coords: Position[],
  anchorIdx: number,
  halfWidthM: number,
): [Position, Position] {
  const n = coords.length;
  const i = Math.max(0, Math.min(n - 1, anchorIdx));
  const prev = coords[Math.max(0, i - 1)];
  const next = coords[Math.min(n - 1, i + 1)];
  const dxM = (next[0] - prev[0]) * METERS_PER_DEG_LON;
  const dyM = (next[1] - prev[1]) * METERS_PER_DEG_LAT;
  const len = Math.hypot(dxM, dyM);
  if (len === 0) {
    return [coords[i], coords[i]];
  }
  const nxM = -dyM / len;
  const nyM = dxM / len;
  const aXM = nxM * halfWidthM;
  const aYM = nyM * halfWidthM;
  const aLon = aXM / METERS_PER_DEG_LON;
  const aLat = aYM / METERS_PER_DEG_LAT;
  return [
    [coords[i][0] - aLon, coords[i][1] - aLat],
    [coords[i][0] + aLon, coords[i][1] + aLat],
  ];
}

type LaneletSubtype = "road" | "bicycle_lane" | "crosswalk" | "walkway";

function laneletSubtypeFor(highway: string): LaneletSubtype {
  if (highway === "cycleway") return "bicycle_lane";
  if (highway === "footway" || highway === "pedestrian") return "walkway";
  // Crosswalks are technically `subtype=crosswalk` on lanelets that span an
  // intersection. We never have ground truth for that, so we don't emit any.
  return "road";
}

function speedLimitFor(highway: string): string {
  switch (highway) {
    case "motorway":
    case "motorway_link":
      return "65 mph";
    case "trunk":
    case "trunk_link":
      return "55 mph";
    case "primary":
    case "primary_link":
      return "35 mph";
    case "secondary":
    case "secondary_link":
      return "30 mph";
    case "tertiary":
    case "tertiary_link":
      return "30 mph";
    case "residential":
      return "25 mph";
    case "living_street":
      return "15 mph";
    case "service":
      return "15 mph";
    case "cycleway":
      return "20 mph";
    case "footway":
    case "pedestrian":
      return "5 mph";
    default:
      return "25 mph";
  }
}

function oneWayFor(highway: string, seed: number): "yes" | "no" {
  // Source OSM extract has no oneway tags, so we synthesize. Motorway and
  // trunk are one-way per directional carriageway in real SF; on grid streets
  // ~30% of primary/secondary are one-way (Bush, Pine, Geary, etc.). We
  // approximate with a deterministic hash so reruns are stable.
  if (
    highway === "motorway" ||
    highway === "motorway_link" ||
    highway === "trunk" ||
    highway === "trunk_link"
  ) {
    return "yes";
  }
  if (
    highway === "primary" ||
    highway === "primary_link" ||
    highway === "secondary" ||
    highway === "secondary_link"
  ) {
    return hash(seed) < 0.3 ? "yes" : "no";
  }
  return "no";
}

function locationFor(highway: string): "urban" | "nonurban" {
  if (
    highway === "motorway" ||
    highway === "motorway_link" ||
    highway === "trunk" ||
    highway === "trunk_link"
  ) {
    return "nonurban";
  }
  return "urban";
}

// Boundary line subtype variety. In Lanelet2: solid (do not cross), dashed
// (lane change OK), virtual (no painted line, e.g. centerline of two-lane
// street), curbstone (physical curb).
function boundarySubtypeFor(
  side: "left" | "right",
  highway: string,
  seed: number,
): { type: string; subtype: string } {
  const r = hash(seed);
  // Sidewalks have curbs on both sides
  if (highway === "footway" || highway === "pedestrian") {
    return { type: "curbstone", subtype: "low" };
  }
  if (highway === "motorway" || highway === "motorway_link") {
    // freeway shoulders: solid white outside, solid yellow inside
    return { type: "line_thin", subtype: "solid" };
  }
  // Right boundary often a curb on residential / service
  if (
    side === "right" &&
    (highway === "residential" ||
      highway === "service" ||
      highway === "living_street") &&
    r < 0.6
  ) {
    return { type: "curbstone", subtype: "low" };
  }
  // Lane-change-permitted dashed boundary on a chunk of primary/secondary
  if (
    (highway === "primary" || highway === "secondary" || highway === "tertiary") &&
    r < 0.35
  ) {
    return { type: "line_thin", subtype: "dashed" };
  }
  // Some boundaries are virtual (no paint, conceptual divider)
  if (r > 0.92) {
    return { type: "virtual", subtype: "" };
  }
  return { type: "line_thin", subtype: "solid" };
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
      if (v === "") continue;
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
      if (v === "") continue;
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
  regulatoryElementCount: number;
  stopLineCount: number;
  trafficLightCount: number;
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

  let stopLineCount = 0;
  let trafficLightCount = 0;
  let regulatoryElementCount = 0;

  segments.forEach((seg, idx) => {
    const seed = idx * 2654435761;
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

    const leftBoundary = boundarySubtypeFor("left", seg.highway, seed ^ 0x9e3779b9);
    const leftWayId = allocId();
    ways.push({
      id: leftWayId,
      nodeRefs: leftNodeIds,
      tags: { type: leftBoundary.type, subtype: leftBoundary.subtype },
    });

    const rightBoundary = boundarySubtypeFor("right", seg.highway, seed ^ 0x6a09e667);
    const rightWayId = allocId();
    ways.push({
      id: rightWayId,
      nodeRefs: rightNodeIds,
      tags: { type: rightBoundary.type, subtype: rightBoundary.subtype },
    });

    const laneletId = allocId();
    const llSubtype = laneletSubtypeFor(seg.highway);
    const speedLimit = speedLimitFor(seg.highway);
    const oneWay = oneWayFor(seg.highway, seed);
    const location = locationFor(seg.highway);

    const relTags: Record<string, string> = {
      type: "lanelet",
      subtype: llSubtype,
      location,
      one_way: oneWay,
      speed_limit: speedLimit,
      road_type: seg.highway,
    };
    if (llSubtype === "road") {
      relTags["participant:vehicle"] = "yes";
    } else if (llSubtype === "bicycle_lane") {
      relTags["participant:bicycle"] = "yes";
    } else if (llSubtype === "walkway") {
      relTags["participant:pedestrian"] = "yes";
    }
    if (seg.name) relTags.name = seg.name;

    const laneletMembers: XmlRelation["members"] = [
      { type: "way", ref: leftWayId, role: "left" },
      { type: "way", ref: rightWayId, role: "right" },
    ];

    // Stop line on ~30% of road lanelets (not on walkways / bike lanes)
    const wantsStopLine = llSubtype === "road" && hash(seed ^ 0x12345) < 0.3;
    let stopLineWayId: number | null = null;
    if (wantsStopLine && seg.coords.length >= 2) {
      const [a, b] = perpendicularBar(
        seg.coords,
        seg.coords.length - 1,
        STOP_LINE_HALF_WIDTH_M,
      );
      const aId = allocId();
      const bId = allocId();
      nodes.push({ id: aId, lon: a[0], lat: a[1] });
      nodes.push({ id: bId, lon: b[0], lat: b[1] });
      stopLineWayId = allocId();
      ways.push({
        id: stopLineWayId,
        nodeRefs: [aId, bId],
        tags: { type: "line_thin", subtype: "solid" },
      });

      const stopReId = allocId();
      relations.push({
        id: stopReId,
        members: [{ type: "way", ref: stopLineWayId, role: "ref_line" }],
        tags: { type: "regulatory_element", subtype: "stop_line" },
      });
      laneletMembers.push({
        type: "relation",
        ref: stopReId,
        role: "regulatory_element",
      });
      stopLineCount++;
      regulatoryElementCount++;

      // ~50% of stop-line lanelets also get a traffic light
      if (hash(seed ^ 0xabcdef) < 0.5) {
        const lightAnchor = Math.max(0, seg.coords.length - 2);
        const [la, lb] = perpendicularBar(
          seg.coords,
          lightAnchor,
          TRAFFIC_LIGHT_HALF_WIDTH_M,
        );
        const laId = allocId();
        const lbId = allocId();
        nodes.push({ id: laId, lon: la[0], lat: la[1] });
        nodes.push({ id: lbId, lon: lb[0], lat: lb[1] });
        const lightWayId = allocId();
        ways.push({
          id: lightWayId,
          nodeRefs: [laId, lbId],
          tags: { type: "traffic_light", subtype: "red_yellow_green" },
        });

        const lightReId = allocId();
        relations.push({
          id: lightReId,
          members: [
            { type: "way", ref: lightWayId, role: "refers" },
            { type: "way", ref: stopLineWayId, role: "ref_line" },
          ],
          tags: { type: "regulatory_element", subtype: "traffic_light" },
        });
        laneletMembers.push({
          type: "relation",
          ref: lightReId,
          role: "regulatory_element",
        });
        trafficLightCount++;
        regulatoryElementCount++;
      }
    }

    relations.push({
      id: laneletId,
      members: laneletMembers,
      tags: relTags,
    });
  });

  const xml = buildXml(nodes, ways, relations, bbox);
  return {
    xml,
    nodeCount: nodes.length,
    wayCount: ways.length,
    laneletCount: segments.length,
    regulatoryElementCount,
    stopLineCount,
    trafficLightCount,
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
    `wrote ${outputPath}:\n  ${result.laneletCount} lanelets\n  ${result.wayCount} ways\n  ${result.nodeCount} nodes\n  ${result.regulatoryElementCount} regulatory elements (${result.stopLineCount} stop lines, ${result.trafficLightCount} traffic lights)`,
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
