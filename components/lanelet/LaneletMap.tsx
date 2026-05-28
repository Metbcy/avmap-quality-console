"use client";

import { useEffect, useRef } from "react";
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

export default function LaneletMap({
  data,
  bbox,
  selectedLaneletId,
  onLaneletClick,
}: LaneletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onClickRef = useRef(onLaneletClick);
  useEffect(() => {
    onClickRef.current = onLaneletClick;
  }, [onLaneletClick]);

  useEffect(() => {
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
  }, []);

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

  return <div ref={containerRef} className="absolute inset-0" />;
}
