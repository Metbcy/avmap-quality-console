"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
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

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { city, tiles, threshold, showOnlyFlagged, flags, onTileClick },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onTileClickRef = useRef(onTileClick);
  useEffect(() => {
    onTileClickRef.current = onTileClick;
  }, [onTileClick]);

  useImperativeHandle(ref, () => ({
    flyTo: (lng, lat, zoom) => {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({ center: [lng, lat], zoom: zoom ?? Math.max(map.getZoom(), 16), duration: 600 });
    },
  }));

  useEffect(() => {
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
          "fill-color": [
            "match", ["get", "bucket"],
            2, "#22c55e",
            1, "#eab308",
            0, "#ef4444",
            "#888888",
          ],
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
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const url = `/data/${city}.geojson`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const apply = () => {
          const src = map.getSource(ROADS_SOURCE) as maplibregl.GeoJSONSource | undefined;
          if (src) src.setData(data);
        };
        if (map.isStyleLoaded()) apply();
        else map.once("load", apply);
      })
      .catch(() => {});
    const c = CITIES[city];
    map.flyTo({ center: c.center, zoom: c.zoom, duration: 800 });
    return () => { cancelled = true; };
  }, [city]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource(TILE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(tiles);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [tiles]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource(FLAGS_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const fc: FeatureCollection = { type: "FeatureCollection", features: flags };
      src.setData(fc);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [flags]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const filter: maplibregl.FilterSpecification | null = showOnlyFlagged
        ? ["<", ["get", "readiness_score"], threshold]
        : null;
      if (map.getLayer("tiles-fill")) map.setFilter("tiles-fill", filter);
      if (map.getLayer("tiles-line")) map.setFilter("tiles-line", filter);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [threshold, showOnlyFlagged]);

  return <div ref={containerRef} className="absolute inset-0" />;
});

export default MapView;
