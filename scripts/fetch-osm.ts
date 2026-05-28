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

function elementsToGeoJSON(
  resp: OverpassResponse,
): FeatureCollection<LineString | Point> {
  const features: Feature<LineString | Point>[] = [];
  for (const el of resp.elements) {
    if (el.type === "way" && el.geometry && el.geometry.length >= 2) {
      const coords: Position[] = el.geometry.map((g) => [g.lon, g.lat]);
      features.push({
        type: "Feature",
        id: `way/${el.id}`,
        geometry: { type: "LineString", coordinates: coords },
        properties: {
          kind: "road",
          highway: el.tags?.highway ?? null,
          name: el.tags?.name ?? null,
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
