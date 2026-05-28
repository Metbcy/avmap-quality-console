/**
 * Builds public/data/sf_overture.geojson from the local OSM extract.
 *
 * Data source decision: a real Overture transportation pull requires either
 * the `overturemaps-py` CLI (Python + boto3 + ~hundreds of MB of S3 traffic
 * per bbox) or a DuckDB httpfs query against source.coop. Neither is viable
 * in this CI environment, so we synthesise a stub that mimics Overture's
 * flattened transportation schema (class/subclass/lanes/maxspeed/oneway)
 * derived from the OSM extract:
 *
 *  - sample ~500 ways stratified across highway classes
 *  - perturb geometry by ~5% of one tile-step to fake digitisation drift
 *  - populate lanes/maxspeed/oneway from class-based defaults (deterministic)
 *  - emit ~5% intentional differences (different lane count vs OSM-derived
 *    default) flagged via `_diverges_from_osm: true` so a downstream diff
 *    view could surface them
 *  - copy a fraction of the OSM signal/stop nodes; Overture's transportation
 *    layer carries control nodes via `transportation/segment` connectors, but
 *    for the demo we keep them as Points with the same `kind` keys so the
 *    tag-rollup is source-agnostic.
 *
 * Run: npx tsx scripts/make-overture-stub.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Position,
} from "geojson";

type OsmProps = { kind?: string; highway?: string | null; name?: string | null };

interface ClassDefaults {
  klass: string;
  subclass: string;
  lanes: number;
  maxspeed: number;
  oneway: "yes" | "no";
}

// Approximation of OSM defaults wiki + Overture transportation enum names.
function defaultsForHighway(h: string | null | undefined): ClassDefaults {
  switch (h) {
    case "motorway":
      return { klass: "motorway", subclass: "motorway", lanes: 4, maxspeed: 105, oneway: "yes" };
    case "motorway_link":
      return { klass: "motorway", subclass: "motorway_link", lanes: 1, maxspeed: 70, oneway: "yes" };
    case "trunk":
      return { klass: "trunk", subclass: "trunk", lanes: 3, maxspeed: 90, oneway: "no" };
    case "trunk_link":
      return { klass: "trunk", subclass: "trunk_link", lanes: 1, maxspeed: 60, oneway: "yes" };
    case "primary":
      return { klass: "primary", subclass: "primary", lanes: 2, maxspeed: 65, oneway: "no" };
    case "primary_link":
      return { klass: "primary", subclass: "primary_link", lanes: 1, maxspeed: 50, oneway: "yes" };
    case "secondary":
      return { klass: "secondary", subclass: "secondary", lanes: 2, maxspeed: 55, oneway: "no" };
    case "secondary_link":
      return { klass: "secondary", subclass: "secondary_link", lanes: 1, maxspeed: 45, oneway: "yes" };
    case "tertiary":
      return { klass: "tertiary", subclass: "tertiary", lanes: 2, maxspeed: 50, oneway: "no" };
    case "tertiary_link":
      return { klass: "tertiary", subclass: "tertiary_link", lanes: 1, maxspeed: 40, oneway: "yes" };
    case "residential":
      return { klass: "residential", subclass: "residential", lanes: 2, maxspeed: 40, oneway: "no" };
    case "living_street":
      return { klass: "living_street", subclass: "living_street", lanes: 1, maxspeed: 25, oneway: "no" };
    case "service":
      return { klass: "service", subclass: "service", lanes: 1, maxspeed: 25, oneway: "no" };
    case "unclassified":
      return { klass: "unclassified", subclass: "unclassified", lanes: 2, maxspeed: 50, oneway: "no" };
    default:
      return { klass: "minor", subclass: h ?? "unknown", lanes: 1, maxspeed: 30, oneway: "no" };
  }
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tile-step magnitudes from scoring.ts; 5% perturbation amounts to a few
// metres of drift, enough to look like real cross-source jitter without
// shifting ways out of their bbox.
const LAT_PERTURB = 0.0009 * 0.05;
const LNG_PERTURB = 0.00114 * 0.05;

async function main() {
  const inPath = resolve(process.cwd(), "public/data/sf.geojson");
  const outPath = resolve(process.cwd(), "public/data/sf_overture.geojson");
  const raw = await readFile(inPath, "utf8");
  const src = JSON.parse(raw) as FeatureCollection;

  const roads = src.features.filter(
    (f) => f.geometry?.type === "LineString" && (f.properties as OsmProps)?.kind === "road",
  ) as Feature<LineString, OsmProps>[];
  const nodes = src.features.filter((f) => f.geometry?.type === "Point") as Feature<Point, { kind?: string }>[];

  // Stratified sample by highway class so we keep at least one of each.
  const byClass = new Map<string, Feature<LineString, OsmProps>[]>();
  for (const r of roads) {
    const k = r.properties?.highway ?? "unknown";
    const arr = byClass.get(k) ?? [];
    arr.push(r);
    byClass.set(k, arr);
  }

  const TARGET = 500;
  const totalRoads = roads.length;
  const sampled: Feature<LineString, OsmProps>[] = [];
  for (const [, arr] of byClass) {
    const share = Math.max(1, Math.round((arr.length / totalRoads) * TARGET));
    const stride = Math.max(1, Math.floor(arr.length / share));
    for (let i = 0; i < arr.length && sampled.length < TARGET * 2; i += stride) {
      sampled.push(arr[i]);
    }
  }
  sampled.sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
  const ways = sampled.slice(0, TARGET);

  const features: Feature[] = [];
  let diverges = 0;
  for (const w of ways) {
    const id = String(w.id ?? "way/0");
    const rng = mulberry32(fnv1a("overture:" + id));
    const d = defaultsForHighway(w.properties?.highway);
    const perturbed: Position[] = w.geometry.coordinates.map(([x, y]) => [
      x + (rng() * 2 - 1) * LNG_PERTURB,
      y + (rng() * 2 - 1) * LAT_PERTURB,
    ]);
    // 5% intentional divergence: bump lane count up or down by 1.
    const diverge = rng() < 0.05;
    let lanes = d.lanes;
    if (diverge) {
      lanes = Math.max(1, d.lanes + (rng() < 0.5 ? -1 : 1));
      diverges++;
    }
    features.push({
      type: "Feature",
      id: id.replace("way/", "overture/segment/"),
      geometry: { type: "LineString", coordinates: perturbed },
      properties: {
        kind: "road",
        class: d.klass,
        subclass: d.subclass,
        highway: w.properties?.highway ?? null,
        name: w.properties?.name ?? null,
        lanes,
        maxspeed: d.maxspeed,
        oneway: d.oneway,
        source: "overture",
        ...(diverge ? { _diverges_from_osm: true } : {}),
      },
    });
  }

  // Carry roughly one in three control nodes - Overture's coverage of these
  // is denser in some regions, sparser in others, so the difference vs OSM
  // is itself an interesting signal in the tile rollup.
  const nodeStride = 3;
  for (let i = 0; i < nodes.length; i += nodeStride) {
    const n = nodes[i];
    const rng = mulberry32(fnv1a("overture-node:" + String(n.id ?? i)));
    features.push({
      type: "Feature",
      id: String(n.id ?? `node/${i}`).replace("node/", "overture/connector/"),
      geometry: {
        type: "Point",
        coordinates: [
          n.geometry.coordinates[0] + (rng() * 2 - 1) * LNG_PERTURB,
          n.geometry.coordinates[1] + (rng() * 2 - 1) * LAT_PERTURB,
        ],
      },
      properties: { kind: n.properties?.kind, source: "overture" },
    });
  }

  const fc: FeatureCollection = { type: "FeatureCollection", features };
  await writeFile(outPath, JSON.stringify(fc));
  console.log(
    `wrote ${outPath}: ${features.length} features (ways=${ways.length}, nodes=${features.length - ways.length}, divergences=${diverges})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
