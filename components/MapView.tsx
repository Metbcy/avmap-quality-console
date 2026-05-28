"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { CITIES, type CityId, type TileCollection, type TileFeature } from "@/lib/scoring";

interface MapViewProps {
  city: CityId;
  tiles: TileCollection;
  threshold: number;
  showOnlyFlagged: boolean;
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
  layers: [
    { id: "carto-dark", type: "raster", source: "carto-dark" },
  ],
};

const TILE_SOURCE = "tiles";
const ROADS_SOURCE = "roads";

export default function MapView({
  city,
  tiles,
  threshold,
  showOnlyFlagged,
  onTileClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onTileClickRef = useRef(onTileClick);
  useEffect(() => {
    onTileClickRef.current = onTileClick;
  }, [onTileClick]);

  // Init map once
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
      map.addSource(ROADS_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "roads-line",
        type: "line",
        source: ROADS_SOURCE,
        paint: {
          "line-color": "#818cf8",
          "line-width": 1.2,
          "line-opacity": 0.55,
        },
      });

      map.addSource(TILE_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "tiles-fill",
        type: "fill",
        source: TILE_SOURCE,
        paint: {
          "fill-color": [
            "match",
            ["get", "bucket"],
            2, "#22c55e",
            1, "#eab308",
            0, "#ef4444",
            "#888888",
          ],
          "fill-opacity": [
            "match",
            ["get", "bucket"],
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
        paint: {
          "line-color": "#ffffff",
          "line-width": 0.5,
          "line-opacity": 0.06,
        },
      });

      map.on("click", "tiles-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        onTileClickRef.current(f as unknown as TileFeature);
      });
      map.on("mouseenter", "tiles-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "tiles-fill", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load roads on city change
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

    return () => {
      cancelled = true;
    };
  }, [city]);

  // Update tiles data
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

  // Update filter (show-only-flagged)
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
}
