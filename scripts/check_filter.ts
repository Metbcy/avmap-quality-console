import { generateTiles, filterTilesToRoads } from "../lib/scoring";
import fs from "node:fs";
const roads = JSON.parse(fs.readFileSync("public/data/sf.geojson","utf8"));
const all = generateTiles("sf");
const kept = filterTilesToRoads(all, roads);
console.log("all:", all.features.length, "kept:", kept.features.length, "dropped:", all.features.length - kept.features.length);
