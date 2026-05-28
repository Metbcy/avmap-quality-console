"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { LaneletGeoJSON, LaneletPolygonProperties } from "@/lib/lanelet2/toGeoJSON";

interface LaneletMapProps {
  data: LaneletGeoJSON;
  bbox: [number, number, number, number];
  selectedLaneletId: string | null;
  onLaneletClick: (props: LaneletPolygonProperties) => void;
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

const LANELETS_SRC = "lanelets";
const BOUNDARIES_SRC = "boundaries";
const STOPLINES_SRC = "stoplines";
const LIGHTS_SRC = "lights";

// Static SVG fallback used in headless screenshot mode (?nogl=1). Renders the
// same lanelet polygons, boundaries, stoplines, and traffic lights but without
// touching MapLibre / WebGL.
function NoGlLaneletMap({ data, bbox, selectedLaneletId }: LaneletMapProps) {
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

  // Zoom to the region of interest: where stop lines + traffic lights cluster.
  // The full extract often spans km, while the signalized intersection sits in
  // a few hundred meters. Falls back to tight feature bounds, then bbox.
  const tight = useMemo(() => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const expand = (coords: number[]) => {
      const [lng, lat] = coords;
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    };
    for (const f of data.stopLines.features) {
      if (f.geometry.type === "LineString") {
        for (const c of f.geometry.coordinates) expand(c as number[]);
      }
    }
    for (const f of data.trafficLights.features) {
      if (f.geometry.type === "Point") expand(f.geometry.coordinates as number[]);
    }
    // If signals/stop lines didn't give us a region, fall back to all polygons
    if (!isFinite(w) || e - w < 1e-6 || n - s < 1e-6) {
      for (const f of data.lanelets.features) {
        if (f.geometry.type === "Polygon") {
          for (const c of f.geometry.coordinates[0]) expand(c as number[]);
        }
      }
    }
    if (!isFinite(w)) {
      return { w: bbox[0], s: bbox[1], e: bbox[2], n: bbox[3] };
    }
    // Pad to ~3x the signal cluster size so neighboring lanelets are in view
    const cx = (w + e) / 2, cy = (s + n) / 2;
    const halfW = Math.max((e - w) * 1.5, 0.0008);
    const halfH = Math.max((n - s) * 1.5, 0.0004);
    return { w: cx - halfW, e: cx + halfW, s: cy - halfH, n: cy + halfH };
  }, [data.lanelets, data.boundaries, data.stopLines, data.trafficLights, bbox]);

  const project = useMemo(() => {
    const padX = (tight.e - tight.w) * 0.05;
    const padY = (tight.n - tight.s) * 0.05;
    const w = tight.w - padX, e = tight.e + padX, s = tight.s - padY, n = tight.n + padY;
    const sx = size.w / (e - w);
    const sy = size.h / (n - s);
    const scale = Math.min(sx, sy);
    const offX = (size.w - (e - w) * scale) / 2;
    const offY = (size.h - (n - s) * scale) / 2;
    return (lng: number, lat: number): [number, number] => [
      offX + (lng - w) * scale,
      offY + (n - lat) * scale,
    ];
  }, [tight.w, tight.e, tight.s, tight.n, size.w, size.h]);

  const ring = (coords: number[][]) =>
    coords.map(([lng, lat]) => project(lng, lat)).map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  return (
    <div ref={containerRef} className="absolute inset-0 bg-[#0a0a0a]">
      <svg width={size.w} height={size.h} className="block">
        <defs>
          <pattern id="ll-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f2937" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#ll-grid)" />

        {/* lanelets (polygons) - bright fill for visibility at extract scale */}
        {data.lanelets.features.map((f, i) => {
          const sel = f.properties?.lanelet_id === selectedLaneletId;
          const g = f.geometry;
          if (g.type !== "Polygon") return null;
          return (
            <polygon
              key={`ll${i}`}
              points={ring(g.coordinates[0])}
              fill={sel ? "#fde047" : "#818cf8"}
              fillOpacity={sel ? 0.9 : 0.85}
              stroke={sel ? "#fde047" : "#c7d2fe"}
              strokeWidth={sel ? 2.5 : 1}
              strokeOpacity={1}
            />
          );
        })}

        {/* boundaries */}
        {data.boundaries.features.map((f, i) => {
          const g = f.geometry;
          if (g.type !== "LineString") return null;
          return (
            <polyline
              key={`b${i}`}
              points={ring(g.coordinates)}
              fill="none"
              stroke="#cbd5e1"
              strokeOpacity={0.75}
              strokeWidth={1.2}
            />
          );
        })}

        {/* stop lines */}
        {data.stopLines.features.map((f, i) => {
          const g = f.geometry;
          if (g.type !== "LineString") return null;
          return (
            <polyline
              key={`s${i}`}
              points={ring(g.coordinates)}
              fill="none"
              stroke="#ef4444"
              strokeOpacity={1}
              strokeWidth={4}
            />
          );
        })}

        {/* traffic lights */}
        {data.trafficLights.features.map((f, i) => {
          const g = f.geometry;
          if (g.type !== "Point") return null;
          const [x, y] = project(...(g.coordinates as [number, number]));
          return (
            <circle
              key={`t${i}`}
              cx={x}
              cy={y}
              r={6}
              fill="#facc15"
              stroke="#7c2d12"
              strokeWidth={1.5}
            />
          );
        })}

        <text x={12} y={size.h - 10} fill="#6b7280" fontSize="10" fontFamily="monospace">
          Lanelet2 · {data.lanelets.features.length} lanelets · {data.stopLines.features.length} stop lines · {data.trafficLights.features.length} signals · static
        </text>
      </svg>
    </div>
  );
}

export default function LaneletMap(props: LaneletMapProps) {
  const { data, bbox, selectedLaneletId, onLaneletClick } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onClickRef = useRef(onLaneletClick);
  useEffect(() => {
    onClickRef.current = onLaneletClick;
  }, [onLaneletClick]);

  const [nogl] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("nogl");
  });

  useEffect(() => {
    if (nogl) return;
    if (!containerRef.current || mapRef.current) return;

    const centerLon = (bbox[0] + bbox[2]) / 2;
    const centerLat = (bbox[1] + bbox[3]) / 2;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [centerLon, centerLat],
      zoom: 17,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 40, duration: 0 },
      );

      map.addSource(LANELETS_SRC, { type: "geojson", data: data.lanelets });
      map.addSource(BOUNDARIES_SRC, { type: "geojson", data: data.boundaries });
      map.addSource(STOPLINES_SRC, { type: "geojson", data: data.stopLines });
      map.addSource(LIGHTS_SRC, { type: "geojson", data: data.trafficLights });

      map.addLayer({
        id: "lanelets-fill",
        type: "fill",
        source: LANELETS_SRC,
        paint: {
          "fill-color": "#6366f1",
          "fill-opacity": [
            "case",
            ["==", ["get", "lanelet_id"], ["literal", selectedLaneletId ?? ""]],
            0.55,
            0.18,
          ],
        },
      });
      map.addLayer({
        id: "lanelets-outline",
        type: "line",
        source: LANELETS_SRC,
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "lanelet_id"], ["literal", selectedLaneletId ?? ""]],
            "#fde047",
            "#818cf8",
          ],
          "line-width": [
            "case",
            ["==", ["get", "lanelet_id"], ["literal", selectedLaneletId ?? ""]],
            2.5,
            1,
          ],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "boundaries-line",
        type: "line",
        source: BOUNDARIES_SRC,
        paint: {
          "line-color": "#9ca3af",
          "line-width": 0.6,
          "line-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "stoplines-line",
        type: "line",
        source: STOPLINES_SRC,
        paint: {
          "line-color": "#ef4444",
          "line-width": 3,
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "lights-circle",
        type: "circle",
        source: LIGHTS_SRC,
        paint: {
          "circle-color": "#facc15",
          "circle-radius": 5,
          "circle-stroke-color": "#7c2d12",
          "circle-stroke-width": 1,
        },
      });

      map.on("click", "lanelets-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        onClickRef.current(f.properties as unknown as LaneletPolygonProperties);
      });
      map.on("mouseenter", "lanelets-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "lanelets-fill", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nogl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const sel = selectedLaneletId ?? "";
      if (map.getLayer("lanelets-fill")) {
        map.setPaintProperty("lanelets-fill", "fill-opacity", [
          "case",
          ["==", ["get", "lanelet_id"], ["literal", sel]],
          0.55,
          0.18,
        ]);
      }
      if (map.getLayer("lanelets-outline")) {
        map.setPaintProperty("lanelets-outline", "line-color", [
          "case",
          ["==", ["get", "lanelet_id"], ["literal", sel]],
          "#fde047",
          "#818cf8",
        ]);
        map.setPaintProperty("lanelets-outline", "line-width", [
          "case",
          ["==", ["get", "lanelet_id"], ["literal", sel]],
          2.5,
          1,
        ]);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [selectedLaneletId]);

  if (nogl) return <NoGlLaneletMap {...props} />;
  return <div ref={containerRef} className="absolute inset-0" />;
}
