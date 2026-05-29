/**
 * Fetches OpenStreetMap highway data via the Overpass API for two bounding
 * boxes and writes compact GeoJSON FeatureCollections to public/data/.
 *
 * Part of an independent open-source prototype exploring tooling for
 * high-stakes geospatial data quality.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Position,
} from "geojson";

type Bbox = { south: number; west: number; north: number; east: number };

type City = {
  id: "sf" | "mv";
  name: string;
  bbox: Bbox;
};

const CITIES: City[] = [
  {
    id: "sf",
    name: "San Francisco",
    bbox: { south: 37.7, west: -122.52, north: 37.83, east: -122.36 },
  },
  {
    id: "mv",
    name: "Mountain View",
    bbox: { south: 37.36, west: -122.12, north: 37.43, east: -122.04 },
  },
];

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const MAX_RETRIES = 3;

type OverpassNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

type OverpassWay = {
  type: "way";
  id: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements: (OverpassNode | OverpassWay)[];
};

function buildQuery(b: Bbox): string {
  return `[out:json][timeout:60];
(
  way["highway"](${b.south},${b.west},${b.north},${b.east});
  node["highway"="traffic_signals"](${b.south},${b.west},${b.north},${b.east});
  node["highway"="stop"](${b.south},${b.west},${b.north},${b.east});
);
out body geom;`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchOverpass(query: string): Promise<OverpassResponse> {
  let lastError: unknown = null;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "avmap-fetcher/0.1 (open-source geospatial QA prototype)",
            Accept: "application/json",
          },
          body: "data=" + encodeURIComponent(query),
        });
        if (res.status === 429 || res.status >= 500) {
          const backoff = 2 ** attempt * 1000;
          console.warn(
            `  ${endpoint} returned ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} after ${backoff}ms`,
          );
          await sleep(backoff);
          continue;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${endpoint}`);
        }
        return (await res.json()) as OverpassResponse;
      } catch (err) {
        lastError = err;
        const backoff = 2 ** attempt * 1000;
        console.warn(
          `  ${endpoint} threw (${(err as Error).message}), retry ${attempt + 1}/${MAX_RETRIES} after ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
    console.warn(`  Giving up on ${endpoint}, moving to next mirror`);
  }
  throw new Error(
    `All Overpass mirrors failed. Last error: ${(lastError as Error)?.message ?? "unknown"}`,
  );
}

// OSM `maxspeed` values are messy strings: "35 mph", "50", "50 km/h", "RU:urban".
// Return null when we can't confidently parse a number.
function parseMaxspeedMph(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(mph|kmh|km\/h|kph)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2];
  // OSM spec: bare number = km/h. Convert to mph.
  if (!unit || unit === "kmh" || unit === "km/h" || unit === "kph") {
    return Math.round(n * 0.621371);
  }
  return Math.round(n);
}

function parseLanes(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // "2", "2;3", "1.5" — take the first integer-ish value.
  const m = String(raw).split(";")[0].trim().match(/^\d+(?:\.\d+)?$/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) && n > 0 && n <= 12 ? Math.round(n) : null;
}

function defaultLanesForHighway(highway: string | null | undefined): number | null {
  switch (highway) {
    case "motorway": return 3;
    case "motorway_link": return 1;
    case "trunk": return 2;
    case "trunk_link": return 1;
    case "primary": return 2;
    case "primary_link": return 1;
    case "secondary": return 2;
    case "secondary_link": return 1;
    case "tertiary": return 1;
    case "tertiary_link": return 1;
    case "residential": return 1;
    case "living_street": return 1;
    case "service": return 1;
    case "unclassified": return 1;
    default: return null;
  }
}

function parseOneway(raw: string | null | undefined): "yes" | "no" | null {
  if (raw == null) return null;
  const s = String(raw).toLowerCase().trim();
  if (s === "yes" || s === "true" || s === "1" || s === "-1") return "yes";
  if (s === "no" || s === "false" || s === "0") return "no";
  return null;
}

// Motorways and link ramps are oneway by OSM convention even when untagged.
// Everything else defaults to "no" — best-effort, flagged as derived.
function defaultOnewayForHighway(highway: string | null | undefined): "yes" | "no" | null {
  switch (highway) {
    case "motorway":
    case "motorway_link":
    case "trunk_link":
    case "primary_link":
    case "secondary_link":
    case "tertiary_link":
      return "yes";
    case "trunk":
    case "primary":
    case "secondary":
    case "tertiary":
    case "residential":
    case "living_street":
    case "service":
    case "unclassified":
      return "no";
    default:
      return null;
  }
}

// Best-effort defaults when the way has no maxspeed tag. Conservative US urban
// assumptions; flagged downstream as "derived" so it's never mistaken for ground truth.
function defaultMphForHighway(highway: string | null | undefined): number | null {
  switch (highway) {
    case "motorway": return 65;
    case "motorway_link": return 45;
    case "trunk": return 55;
    case "trunk_link": return 35;
    case "primary": return 35;
    case "primary_link": return 25;
    case "secondary": return 30;
    case "secondary_link": return 25;
    case "tertiary": return 25;
    case "tertiary_link": return 20;
    case "residential": return 25;
    case "living_street": return 15;
    case "service": return 15;
    case "unclassified": return 25;
    default: return null;
  }
}

function elementsToGeoJSON(
  resp: OverpassResponse,
): FeatureCollection<LineString | Point> {
  const features: Feature<LineString | Point>[] = [];
  for (const el of resp.elements) {
    if (el.type === "way" && el.geometry && el.geometry.length >= 2) {
      const coords: Position[] = el.geometry.map((g) => [g.lon, g.lat]);
      const highway = el.tags?.highway ?? null;
      const rawMaxspeed = el.tags?.maxspeed ?? null;
      const parsedMph = parseMaxspeedMph(rawMaxspeed);
      const maxspeedMph = parsedMph ?? defaultMphForHighway(highway);

      const rawLanes = el.tags?.lanes ?? null;
      const parsedLanes = parseLanes(rawLanes);
      const lanesCount = parsedLanes ?? defaultLanesForHighway(highway);

      const rawOneway = el.tags?.oneway ?? null;
      const parsedOneway = parseOneway(rawOneway);
      const onewayVal = parsedOneway ?? defaultOnewayForHighway(highway);

      features.push({
        type: "Feature",
        id: `way/${el.id}`,
        geometry: { type: "LineString", coordinates: coords },
        properties: {
          kind: "road",
          highway,
          name: el.tags?.name ?? null,
          maxspeed_mph: maxspeedMph,
          maxspeed_source: parsedMph != null ? "osm" : (maxspeedMph != null ? "derived" : null),
          lanes_count: lanesCount,
          lanes_source: parsedLanes != null ? "osm" : (lanesCount != null ? "derived" : null),
          oneway_bool: onewayVal,
          oneway_source: parsedOneway != null ? "osm" : (onewayVal != null ? "derived" : null),
        },
      });
    } else if (el.type === "node") {
      const tag = el.tags?.highway;
      if (tag === "traffic_signals" || tag === "stop") {
        features.push({
          type: "Feature",
          id: `node/${el.id}`,
          geometry: { type: "Point", coordinates: [el.lon, el.lat] },
          properties: { kind: tag },
        });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

function buildFallback(
  city: City,
): FeatureCollection<LineString | Point> {
  const { south, west, north, east } = city.bbox;
  const lat = (t: number) => south + (north - south) * t;
  const lon = (t: number) => west + (east - west) * t;
  const features: Feature<LineString | Point>[] = [];

  const grid: [number, number][] = [
    [0.2, 0.2],
    [0.2, 0.5],
    [0.2, 0.8],
    [0.5, 0.2],
    [0.5, 0.5],
    [0.5, 0.8],
    [0.8, 0.2],
    [0.8, 0.5],
    [0.8, 0.8],
    [0.35, 0.65],
  ];
  grid.forEach(([y1, y2], i) => {
    const isVertical = i % 2 === 0;
    const coords: Position[] = isVertical
      ? [
          [lon(y1), lat(0.1)],
          [lon(y1), lat(0.9)],
        ]
      : [
          [lon(0.1), lat(y2)],
          [lon(0.9), lat(y2)],
        ];
    features.push({
      type: "Feature",
      id: `fallback/way/${i}`,
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        kind: "road",
        highway: i % 3 === 0 ? "primary" : "residential",
        name: `Sample Road ${i + 1}`,
        maxspeed: null,
        maxspeed_mph: i % 3 === 0 ? 35 : 25,
        maxspeed_source: "derived",
        lanes: null,
        lanes_count: i % 3 === 0 ? 2 : 1,
        lanes_source: "derived",
        oneway: null,
        oneway_bool: "no",
        oneway_source: "derived",
        ...(i === 0 ? { _fallback: true } : {}),
      },
    });
  });

  features.push({
    type: "Feature",
    id: "fallback/node/signal-1",
    geometry: { type: "Point", coordinates: [lon(0.4), lat(0.4)] },
    properties: { kind: "traffic_signals" },
  });
  features.push({
    type: "Feature",
    id: "fallback/node/signal-2",
    geometry: { type: "Point", coordinates: [lon(0.6), lat(0.6)] },
    properties: { kind: "traffic_signals" },
  });
  features.push({
    type: "Feature",
    id: "fallback/node/stop-1",
    geometry: { type: "Point", coordinates: [lon(0.3), lat(0.7)] },
    properties: { kind: "stop" },
  });

  return { type: "FeatureCollection", features };
}

function countByKind(fc: FeatureCollection<LineString | Point>) {
  let roads = 0;
  let signals = 0;
  let stops = 0;
  for (const f of fc.features) {
    const k = f.properties?.kind;
    if (k === "road") roads++;
    else if (k === "traffic_signals") signals++;
    else if (k === "stop") stops++;
  }
  return { roads, signals, stops, total: fc.features.length };
}

async function main() {
  const outDir = resolve(process.cwd(), "public/data");
  await mkdir(outDir, { recursive: true });

  let usedFallback = false;

  for (const city of CITIES) {
    console.log(`\n[${city.id}] Fetching ${city.name} ...`);
    let fc: FeatureCollection<LineString | Point>;
    try {
      const resp = await fetchOverpass(buildQuery(city.bbox));
      fc = elementsToGeoJSON(resp);
      if (fc.features.length === 0) {
        throw new Error("Empty FeatureCollection from Overpass");
      }
    } catch (err) {
      console.warn(
        `WARNING: using fallback sample data for ${city.id} (${(err as Error).message})`,
      );
      usedFallback = true;
      fc = buildFallback(city);
    }

    const counts = countByKind(fc);
    console.log(
      `[${city.id}] roads=${counts.roads} signals=${counts.signals} stops=${counts.stops} total=${counts.total}`,
    );

    const outPath = resolve(outDir, `${city.id}.geojson`);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(fc));
    console.log(`[${city.id}] wrote ${outPath}`);
  }

  if (usedFallback) {
    console.log("\nWARNING: at least one city used fallback sample data.");
  } else {
    console.log("\nAll cities fetched from live Overpass data.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
