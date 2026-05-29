"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { CITIES, type CityId, type TileCollection, type TileFeature } from "@/lib/scoring";
import type { Flag } from "@/lib/validators";

export interface MapViewHandle {
  flyTo: (lng: number, lat: number, zoom?: number) => void;
}

interface MapViewProps {
  city: CityId;
  tiles: TileCollection;
  threshold: number;
  showOnlyFlagged: boolean;
  flags: Flag[];
  roads: FeatureCollection | null;
  sourceLabel: string;
  onTileClick: (tile: TileFeature) => void;
}

const BASEMAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "carto-dark", type: "raster", source: "carto-dark" }],
};

const TILE_SOURCE = "tiles";
const ROADS_SOURCE = "roads";
const FLAGS_SOURCE = "flags";

// Deterministic, dependency-free fallback renderer. Enabled via ?nogl=1
// (used in CI/screenshot pipelines where headless WebGL is flaky). Renders the
// same scoring data MapLibre would render, projected linearly from the city
// bbox into the SVG viewport. Not pannable , intentional, this is for static
// captures and visual regression, not interactive use.
function NoGlMapView({
  city, tiles, threshold, showOnlyFlagged, flags, sourceLabel, onTileClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  const c = CITIES[city];
  const project = useMemo(() => {
    const lonRange = c.east - c.west;
    const latRange = c.north - c.south;
    // preserve aspect: use min scale, center result
    const sx = size.w / lonRange;
    const sy = size.h / latRange;
    const s = Math.min(sx, sy);
    const drawW = lonRange * s;
    const drawH = latRange * s;
    const offX = (size.w - drawW) / 2;
    const offY = (size.h - drawH) / 2;
    return (lng: number, lat: number): [number, number] => [
      offX + (lng - c.west) * s,
      offY + (c.north - lat) * s,
    ];
  }, [c.west, c.east, c.north, c.south, size.w, size.h]);

  const tilePolys = useMemo(() => {
    return tiles.features
      .filter((t) => !showOnlyFlagged || t.properties.readiness_score < threshold)
      .map((t) => {
        const ring = t.geometry.coordinates[0];
        const pts = ring.map(([lng, lat]) => project(lng, lat));
        const bucket = t.properties.bucket as number;
        const fill =
          bucket === 2 ? "#22c55e" : bucket === 1 ? "#eab308" : bucket === 0 ? "#ef4444" : "#888888";
        const opacity = bucket === 2 ? 0.25 : bucket === 1 ? 0.3 : bucket === 0 ? 0.4 : 0.2;
        return { t, pts, fill, opacity };
      });
  }, [tiles, project, showOnlyFlagged, threshold]);

  const flagDots = useMemo(() => {
    // Sample flags so we don't blow up the SVG node count.
    const max = 600;
    const stride = Math.max(1, Math.ceil(flags.length / max));
    const out: { x: number; y: number; sev: string }[] = [];
    for (let i = 0; i < flags.length; i += stride) {
      const f = flags[i];
      const g = f.geometry;
      let lng: number | null = null;
      let lat: number | null = null;
      if (g.type === "Point") {
        [lng, lat] = g.coordinates as [number, number];
      } else if (g.type === "LineString") {
        const m = g.coordinates[Math.floor(g.coordinates.length / 2)] as [number, number];
        [lng, lat] = m;
      }
      if (lng == null || lat == null) continue;
      const [x, y] = project(lng, lat);
      out.push({ x, y, sev: f.properties.severity });
    }
    return out;
  }, [flags, project]);

  const sevColor = (sev: string) =>
    sev === "high" ? "#ef4444" : sev === "med" ? "#eab308" : sev === "low" ? "#34d399" : "#94a3b8";

  return (
    <div ref={containerRef} className="absolute inset-0 bg-[#0a0a0a]">
      <svg width={size.w} height={size.h} className="block">
        {/* subtle graticule */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f2937" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#grid)" />
        {tilePolys.map(({ t, pts, fill, opacity }) => (
          <polygon
            key={t.properties.tile_id}
            points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
            fill={fill}
            fillOpacity={opacity}
            stroke="#ffffff"
            strokeOpacity={0.06}
            strokeWidth={0.5}
            onClick={() => onTileClick(t)}
            style={{ cursor: "pointer" }}
          />
        ))}
        {flagDots.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={2}
            fill={sevColor(d.sev)}
            stroke="#0a0a0a"
            strokeWidth={0.5}
            opacity={0.85}
          />
        ))}
        <text x={12} y={size.h - 10} fill="#6b7280" fontSize="10" fontFamily="monospace">
          {c.label} · {sourceLabel} · {tilePolys.length} tiles · {flagDots.length} flag samples · static render
        </text>
      </svg>
    </div>
  );
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(props, ref) {
  const { city, tiles, threshold, showOnlyFlagged, flags, roads, onTileClick } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onTileClickRef = useRef(onTileClick);
  useEffect(() => {
    onTileClickRef.current = onTileClick;
  }, [onTileClick]);

  // Detect ?nogl=1 once on mount. Stays stable for the lifetime of the page ,
  // avoids ever initializing MapLibre/WebGL in headless screenshot mode.
  const [nogl] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("nogl");
  });

  useImperativeHandle(ref, () => ({
    flyTo: (lng, lat, zoom) => {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({ center: [lng, lat], zoom: zoom ?? Math.max(map.getZoom(), 16), duration: 600 });
    },
  }));

  useEffect(() => {
    if (nogl) return; // SVG fallback path , never init MapLibre
    if (!containerRef.current || mapRef.current) return;
    const c = CITIES[city];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: c.center,
      zoom: c.zoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource(ROADS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "roads-line",
        type: "line",
        source: ROADS_SOURCE,
        paint: { "line-color": "#818cf8", "line-width": 1.2, "line-opacity": 0.55 },
      });

      map.addSource(TILE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "tiles-fill",
        type: "fill",
        source: TILE_SOURCE,
        paint: {
          // fill-color is recomputed live from the threshold slider via
          // setPaintProperty in the threshold effect below. Initial value
          // is a neutral gray; the effect overrides on first paint.
          "fill-color": "#888888",
          "fill-opacity": [
            "match", ["get", "bucket"],
            2, 0.25,
            1, 0.3,
            0, 0.4,
            0.2,
          ],
        },
      });
      map.addLayer({
        id: "tiles-line",
        type: "line",
        source: TILE_SOURCE,
        paint: { "line-color": "#ffffff", "line-width": 0.5, "line-opacity": 0.06 },
      });

      map.addSource(FLAGS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "flags-circle",
        type: "circle",
        source: FLAGS_SOURCE,
        // Hidden at low zoom: tens of thousands of points would crush MapLibre.
        minzoom: 14,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2, 18, 5],
          "circle-color": [
            "match", ["get", "severity"],
            "high", "#ef4444",
            "med", "#eab308",
            "low", "#34d399",
            "#94a3b8",
          ],
          "circle-stroke-color": "#0a0a0a",
          "circle-stroke-width": 0.5,
          "circle-opacity": 0.85,
        },
      });

      map.on("click", "tiles-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        onTileClickRef.current(f as unknown as TileFeature);
      });
      map.on("mouseenter", "tiles-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "tiles-fill", () => { map.getCanvas().style.cursor = ""; });
    });

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nogl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const data: FeatureCollection = roads ?? { type: "FeatureCollection", features: [] };
    // Gate on the source existing, not on isStyleLoaded(): style can read as
    // "not loaded" mid-transition, and `once("load", ...)` would silently
    // never fire (load only fires once per map). Retry via "idle" instead.
    const apply = (): boolean => {
      const src = map.getSource(ROADS_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!src) return false;
      src.setData(data);
      return true;
    };
    if (apply()) return;
    const retry = () => { if (apply()) map.off("idle", retry); };
    map.on("idle", retry);
    return () => { map.off("idle", retry); };
  }, [roads]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = CITIES[city];
    map.flyTo({ center: c.center, zoom: c.zoom, duration: 800 });
  }, [city]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): boolean => {
      const src = map.getSource(TILE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!src) return false;
      src.setData(tiles);
      return true;
    };
    if (apply()) return;
    const retry = () => { if (apply()) map.off("idle", retry); };
    map.on("idle", retry);
    return () => { map.off("idle", retry); };
  }, [tiles]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): boolean => {
      const src = map.getSource(FLAGS_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!src) return false;
      const fc: FeatureCollection = { type: "FeatureCollection", features: flags };
      src.setData(fc);
      return true;
    };
    if (apply()) return;
    const retry = () => { if (apply()) map.off("idle", retry); };
    map.on("idle", retry);
    return () => { map.off("idle", retry); };
  }, [flags]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = (): boolean => {
      if (!map.getLayer("tiles-fill") || !map.getLayer("tiles-line")) return false;
      const filter: maplibregl.FilterSpecification | null = showOnlyFlagged
        ? ["<", ["get", "readiness_score"], threshold]
        : null;
      map.setFilter("tiles-fill", filter);
      map.setFilter("tiles-line", filter);

      // Live recolor: green at/above threshold, yellow in a 0.15 caution band
      // just below, red further below. Slider becomes a "what counts as
      // ready?" knob with immediate visual feedback even when the
      // showOnlyFlagged filter is off.
      const caution = Math.max(0, threshold - 0.15);
      const fillColor: maplibregl.ExpressionSpecification = [
        "step",
        ["get", "readiness_score"],
        "#ef4444",        // < caution
        caution, "#eab308", // caution .. threshold
        threshold, "#22c55e", // >= threshold
      ];
      map.setPaintProperty("tiles-fill", "fill-color", fillColor);
      map.setPaintProperty("tiles-line", "line-color", fillColor);
      return true;
    };
    if (apply()) return;
    const retry = () => { if (apply()) map.off("idle", retry); };
    map.on("idle", retry);
    return () => { map.off("idle", retry); };
  }, [threshold, showOnlyFlagged]);

  if (nogl) return <NoGlMapView {...props} />;
  return <div ref={containerRef} className="absolute inset-0" />;
});

export default MapView;
