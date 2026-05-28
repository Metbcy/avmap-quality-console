# AV Map Quality & Diff Console

An independent open-source prototype exploring tooling for high-stakes geospatial data quality — the kind of internal console an ops team might use to triage HD-map tiles and review pending edits before they ship to fleet.

Built in a few hours with Next.js + MapLibre on top of real OpenStreetMap extracts. All scores and diffs are synthetic, generated locally from a deterministic seeded PRNG so the views are reproducible without a backend.

![Triage overview](screenshots/triage-overview.png)

## What's in here

Two views, both server-rendered with client-side map interactivity:

**Triage** (`/`) — a tile grid over San Francisco or Mountain View, colored by a deterministic readiness score (`lane_marking_confidence`, `sensor_divergence_score`, `stop_sign_confidence`, `construction_flag`). Adjust the threshold, filter to only flagged tiles, click any tile for a per-signal breakdown.

**Diff** (`/diff`) — side-by-side baseline-vs-candidate map view with a queue of pending changes (new lane, moved crosswalk, removed stop sign, blocker construction). Approve or reject inline with a comment.

**Lanelet2 sample** — at `/lanelet`. Loads `public/data/lanelet2_sf_synthetic.osm`, a small Lanelet2-format slice synthesized from the SF OpenStreetMap extract. The script `scripts/synthesize-lanelet.ts` picks ~50 short road centerlines around downtown SF (lon -122.41 to -122.40, lat 37.78 to 37.79), duplicates each one twice, and offsets the copies +/-2m perpendicular to the local tangent (flat-earth approximation at SF latitude) to form synthetic left and right boundaries wrapped in `type=lanelet subtype=road` relations. It is a tooling and parser demo, not a survey: production HD maps are sensor-derived and proprietary.

## Stack

- Next.js 16 App Router, TypeScript strict
- Tailwind v3, dark theme
- MapLibre GL (no API key — Carto's free dark basemap)
- Real OSM highway extracts for SF and MV bboxes, fetched via Overpass and committed under `public/data/`
- Playwright for headless screenshot capture

## Run it

```bash
npm install
npm run build
npm start                     # http://localhost:3000
```

Regenerate the OSM extracts:

```bash
npm run fetch-data            # writes public/data/{sf,mv}.geojson
```

Capture screenshots (requires a display — use `xvfb-run` on a headless box for WebGL):

```bash
xvfb-run -a -s "-screen 0 1440x900x24" node scripts/screenshots.mjs
```

## Screenshots

| | |
|---|---|
| ![Triage filtered](screenshots/triage-filtered.png) | ![Tile detail](screenshots/triage-tile-detail.png) |
| ![Mountain View](screenshots/mv-overview.png) | ![Diff overview](screenshots/diff-overview.png) |

## Data & attribution

Road network © OpenStreetMap contributors, ODbL. Basemap © CARTO. All readiness scores and pending diffs are synthetic, generated locally with a seeded PRNG (`mulberry32` + `fnv1a`) — no real fleet data, no proprietary signals.

Lanelet2 sample data: the file `public/data/lanelet2_sf_synthetic.osm` is generated locally by `scripts/synthesize-lanelet.ts` from `public/data/sf.geojson` (OpenStreetMap, ODbL). No third-party HD-map data is redistributed. Regenerate with `npx tsx scripts/synthesize-lanelet.ts`.

## License

MIT.
