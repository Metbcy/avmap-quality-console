"use client";

import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, Feature } from "geojson";
import maplibregl from "maplibre-gl";
import type { TileCollection } from "@/lib/scoring";
import type { Flag } from "@/lib/validators";
import { haversineKm, sampleLine, countHandoffs, type LngLat } from "@/lib/routeSim";

const SAMPLE_COUNT = 100;
const ANIM_DURATION_MS = 3000;

const SRC_ROUTE = "sim-route";
const SRC_DOT = "sim-dot";
const SRC_MARKERS = "sim-markers";
const LAYER_ROUTE = "sim-route-line";
const LAYER_MARKER_A = "sim-marker-a";
const LAYER_MARKER_B = "sim-marker-b";
const LAYER_DOT = "sim-dot-circle";

type SimPhase = "idle" | "picked_a" | "picked_both" | "done";

interface Props {
  map: maplibregl.Map | null;
  tiles: TileCollection;
  flags: Flag[];
  threshold: number;
}

function emptyFC(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function geoSrc(map: maplibregl.Map, id: string): maplibregl.GeoJSONSource | undefined {
  return map.getSource(id) as maplibregl.GeoJSONSource | undefined;
}

function pointFC(lng: number, lat: number): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {},
      } as Feature,
    ],
  };
}

export default function RouteSim({ map, tiles, flags, threshold }: Props) {
  const [phase, setPhase] = useState<SimPhase>("idle");
  const [pointA, setPointA] = useState<LngLat | null>(null);
  const [pointB, setPointB] = useState<LngLat | null>(null);
  const [handoffCount, setHandoffCount] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [replayKey, setReplayKey] = useState(0);

  // Stable ref so the click handler never captures stale phase state.
  const phaseRef = useRef<SimPhase>("idle");
  phaseRef.current = phase;

  // Add MapLibre sources and layers once; remove them on unmount/map change.
  useEffect(() => {
    if (!map) return;

    const setup = () => {
      if (!map.getSource(SRC_ROUTE))
        map.addSource(SRC_ROUTE, { type: "geojson", data: emptyFC() });
      if (!map.getSource(SRC_MARKERS))
        map.addSource(SRC_MARKERS, { type: "geojson", data: emptyFC() });
      if (!map.getSource(SRC_DOT))
        map.addSource(SRC_DOT, { type: "geojson", data: emptyFC() });

      if (!map.getLayer(LAYER_ROUTE))
        map.addLayer({
          id: LAYER_ROUTE,
          type: "line",
          source: SRC_ROUTE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#818cf8",
            "line-width": 2,
            "line-opacity": 0.85,
            "line-dasharray": [4, 3],
          },
        });

      if (!map.getLayer(LAYER_MARKER_A))
        map.addLayer({
          id: LAYER_MARKER_A,
          type: "circle",
          source: SRC_MARKERS,
          filter: ["==", ["get", "pt"], "A"],
          paint: {
            "circle-radius": 7,
            "circle-color": "#22c55e",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });

      if (!map.getLayer(LAYER_MARKER_B))
        map.addLayer({
          id: LAYER_MARKER_B,
          type: "circle",
          source: SRC_MARKERS,
          filter: ["==", ["get", "pt"], "B"],
          paint: {
            "circle-radius": 7,
            "circle-color": "#ef4444",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });

      if (!map.getLayer(LAYER_DOT))
        map.addLayer({
          id: LAYER_DOT,
          type: "circle",
          source: SRC_DOT,
          paint: {
            "circle-radius": 8,
            "circle-color": "#818cf8",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
          },
        });
    };

    if (map.isStyleLoaded()) {
      setup();
    } else {
      map.once("load", setup);
    }

    return () => {
      try {
        for (const id of [LAYER_DOT, LAYER_MARKER_B, LAYER_MARKER_A, LAYER_ROUTE]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [SRC_DOT, SRC_MARKERS, SRC_ROUTE]) {
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch {
        // Map may already be torn down (city switch while sim is active).
      }
    };
  }, [map]);

  // Crosshair cursor while picking points.
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas();
    if (phase === "idle" || phase === "picked_a") {
      canvas.style.cursor = "crosshair";
    } else {
      canvas.style.cursor = "";
    }
    return () => {
      canvas.style.cursor = "";
    };
  }, [map, phase]);

  // Map click handler — advances the state machine.
  useEffect(() => {
    if (!map) return;

    const handler = (e: maplibregl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const cur = phaseRef.current;
      if (cur === "idle") {
        setPointA({ lng, lat });
        setPhase("picked_a");
      } else if (cur === "picked_a") {
        setPointB({ lng, lat });
        setPhase("picked_both");
      }
    };

    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [map]);

  // Sync marker layer whenever A or B changes.
  useEffect(() => {
    if (!map) return;
    const src = geoSrc(map, SRC_MARKERS);
    if (!src) return;
    const features: Feature[] = [];
    if (pointA)
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [pointA.lng, pointA.lat] },
        properties: { pt: "A" },
      });
    if (pointB)
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [pointB.lng, pointB.lat] },
        properties: { pt: "B" },
      });
    src.setData({ type: "FeatureCollection", features });
  }, [map, pointA, pointB]);

  // Compute handoffs and draw the route line whenever relevant data changes.
  useEffect(() => {
    if (!map || !pointA || !pointB) return;

    geoSrc(map, SRC_ROUTE)?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [pointA.lng, pointA.lat],
              [pointB.lng, pointB.lat],
            ],
          },
          properties: {},
        } as Feature,
      ],
    });

    const samples = sampleLine(pointA, pointB, SAMPLE_COUNT);
    const result = countHandoffs(samples, tiles, flags, threshold);
    setHandoffCount(result.count);
    setDistanceKm(haversineKm(pointA, pointB));
  }, [map, pointA, pointB, tiles, flags, threshold]);

  // Animated dot: runs when phase becomes "picked_both" or replayKey increments.
  useEffect(() => {
    if (!map || !pointA || !pointB || phase !== "picked_both") return;

    let rafId: number;
    let startTs: number | null = null;

    const animate = (ts: number) => {
      if (!startTs) startTs = ts;
      const t = Math.min((ts - startTs) / ANIM_DURATION_MS, 1);
      const lng = pointA.lng + t * (pointB.lng - pointA.lng);
      const lat = pointA.lat + t * (pointB.lat - pointA.lat);
      geoSrc(map, SRC_DOT)?.setData(pointFC(lng, lat));
      if (t < 1) {
        rafId = requestAnimationFrame(animate);
      } else {
        setPhase("done");
      }
    };

    rafId = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(rafId); };
    // replayKey intentionally included: Replay increments it to re-trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pointA, pointB, phase, replayKey]);

  const prompt =
    phase === "idle" ? "Click point A on the map" :
    phase === "picked_a" ? "Click point B on the map" :
    null;

  const showHud = phase === "picked_both" || phase === "done";

  return (
    <>
      {prompt && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded border border-indigo-700 bg-gray-900/90 px-3 py-1.5 text-xs text-indigo-300">
          {prompt}
        </div>
      )}
      {showHud && (
        <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-full border border-gray-700 bg-gray-900/95 px-5 py-2 text-center text-xs shadow-lg">
          <div className="font-medium text-gray-200">
            Sim: A to B &middot; {handoffCount} handoffs over {distanceKm.toFixed(1)}km
          </div>
          <div className="mt-0.5 text-[10px] text-gray-500">
            Synthetic readiness-based heuristic, not a real planner
          </div>
          {phase === "done" && (
            <button
              onClick={() => {
                setPhase("picked_both");
                setReplayKey((k) => k + 1);
              }}
              className="mt-1 block w-full text-center text-[10px] text-indigo-400 hover:text-indigo-300"
            >
              Replay
            </button>
          )}
        </div>
      )}
    </>
  );
}
