/**
 * Runs every Atlas-Checks-style validator against the local OSM extracts and
 * writes a compact FeatureCollection of flags per city to public/data. The
 * triage page loads these at runtime instead of recomputing in the browser.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Feature, FeatureCollection } from "geojson";
import { runValidators } from "../lib/validators";
import type { Flag } from "../lib/validators";

const CITIES = ["sf", "mv"] as const;

async function main() {
  for (const city of CITIES) {
    const inPath = resolve(process.cwd(), `public/data/${city}.geojson`);
    const outPath = resolve(process.cwd(), `public/data/${city}.flags.json`);
    const raw = await readFile(inPath, "utf8");
    const fc = JSON.parse(raw) as FeatureCollection;
    const features: Feature[] = fc.features;
    const t0 = Date.now();
    const flags: Flag[] = runValidators(features);
    const ms = Date.now() - t0;
    const counts = { low: 0, med: 0, high: 0 };
    for (const f of flags) counts[f.properties.severity]++;
    const out: FeatureCollection = { type: "FeatureCollection", features: flags };
    await writeFile(outPath, JSON.stringify(out));
    console.log(
      `[${city}] ${flags.length} flags  (low=${counts.low} med=${counts.med} high=${counts.high})  in ${ms}ms  -> ${outPath}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
