"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Feature } from "geojson";
import maplibregl from "maplibre-gl";
import type { TileCollection } from "@/lib/scoring";
import type { Flag } from "@/lib/validators";
import {
  haversineKm,
  planRoute,
  polylineLengthKm,
  type LngLat,
  type PlannedRoute,
} from "@/lib/routeSim";

const ANIM_DURATION_MS = 3500;

const SRC_STRAIGHT = "sim-straight";
const SRC_PLANNED = "sim-planned";
const SRC_DOT = "sim-dot";
const SRC_MARKERS = "sim-markers";
const LAYER_STRAIGHT = "sim-straight-line";
const LAYER_PLANNED = "sim-planned-line";
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

function lineFC(points: LngLat[]): FeatureCollection {
  if (points.length < 2) return emptyFC();
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: points.map((p) => [p.lng, p.lat]),
        },
        properties: {},
      } as Feature,
    ],
  };
}

/**
 * Interpolate a position along a polyline at fraction t (0..1) of total length.
 * Returns the point and the cumulative km traveled at that fraction.
 */
function interpolateAlong(points: LngLat[], t: number): LngLat {
  if (points.length === 0) return { lng: 0, lat: 0 };
  if (points.length === 1) return points[0];
  if (t <= 0) return points[0];
  if (t >= 1) return points[points.length - 1];
  const total = polylineLengthKm(points);
  const target = t * total;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const segLen = haversineKm(points[i - 1], points[i]);
    if (acc + segLen >= target) {
      const u = segLen > 0 ? (target - acc) / segLen : 0;
      return {
        lng: points[i - 1].lng + u * (points[i].lng - points[i - 1].lng),
        lat: points[i - 1].lat + u * (points[i].lat - points[i - 1].lat),
      };
    }
    acc += segLen;
  }
  return points[points.length - 1];
}

export default function RouteSim({ map, tiles, flags, threshold }: Props) {
  const [phase, setPhase] = useState<SimPhase>("idle");
  const [pointA, setPointA] = useState<LngLat | null>(null);
  const [pointB, setPointB] = useState<LngLat | null>(null);
  const [replayKey, setReplayKey] = useState(0);

  const phaseRef = useRef<SimPhase>("idle");
  phaseRef.current = phase;

  // Compute the planned route + straight-line stats whenever endpoints or data change.
  const route: PlannedRoute | null = useMemo(() => {
    if (!pointA || !pointB) return null;
    return planRoute(pointA, pointB, tiles, flags, threshold);
  }, [pointA, pointB, tiles, flags, threshold]);

  const straightDistanceKm = useMemo(() => {
    if (!pointA || !pointB) return 0;
    return haversineKm(pointA, pointB);
  }, [pointA, pointB]);

  // Add MapLibre sources/layers once.
  useEffect(() => {
    if (!map) return;

    const setup = () => {
      if (!map.getSource(SRC_STRAIGHT))
        map.addSource(SRC_STRAIGHT, { type: "geojson", data: emptyFC() });
      if (!map.getSource(SRC_PLANNED))
        map.addSource(SRC_PLANNED, { type: "geojson", data: emptyFC() });
      if (!map.getSource(SRC_MARKERS))
        map.addSource(SRC_MARKERS, { type: "geojson", data: emptyFC() });
      if (!map.getSource(SRC_DOT))
        map.addSource(SRC_DOT, { type: "geojson", data: emptyFC() });

      // Naive straight line — faded reference for comparison.
      if (!map.getLayer(LAYER_STRAIGHT))
        map.addLayer({
          id: LAYER_STRAIGHT,
          type: "line",
          source: SRC_STRAIGHT,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#71717a",
            "line-width": 1.5,
            "line-opacity": 0.55,
            "line-dasharray": [3, 3],
          },
        });

      // Planned readiness-aware route — bright, prominent.
      if (!map.getLayer(LAYER_PLANNED))
        map.addLayer({
          id: LAYER_PLANNED,
          type: "line",
          source: SRC_PLANNED,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#22d3ee",
            "line-width": 3.5,
            "line-opacity": 0.95,
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
            "circle-color": "#22d3ee",
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
        for (const id of [
          LAYER_DOT,
          LAYER_MARKER_B,
          LAYER_MARKER_A,
          LAYER_PLANNED,
          LAYER_STRAIGHT,
        ]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [SRC_DOT, SRC_MARKERS, SRC_PLANNED, SRC_STRAIGHT]) {
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

  // Draw straight-line and planned-route lines.
  useEffect(() => {
    if (!map || !pointA || !pointB || !route) return;
    geoSrc(map, SRC_STRAIGHT)?.setData(lineFC([pointA, pointB]));
    geoSrc(map, SRC_PLANNED)?.setData(lineFC(route.path));
  }, [map, pointA, pointB, route]);

  // Animated dot — follows the PLANNED polyline.
  useEffect(() => {
    if (!map || !route || route.path.length < 2 || phase !== "picked_both") return;

    let rafId: number;
    let startTs: number | null = null;

    const animate = (ts: number) => {
      if (!startTs) startTs = ts;
      const t = Math.min((ts - startTs) / ANIM_DURATION_MS, 1);
      const pos = interpolateAlong(route.path, t);
      geoSrc(map, SRC_DOT)?.setData(pointFC(pos.lng, pos.lat));
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
  }, [map, route, phase, replayKey]);

  const prompt =
    phase === "idle" ? "Click point A on the map" :
    phase === "picked_a" ? "Click point B on the map" :
    null;

  const showHud = (phase === "picked_both" || phase === "done") && route !== null;

  return (
    <>
      {prompt && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded border border-indigo-700 bg-gray-900/90 px-3 py-1.5 text-xs text-indigo-300">
          {prompt}
        </div>
      )}
      {showHud && route && (
        <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-gray-700 bg-gray-900/95 px-4 py-2.5 text-center text-xs shadow-lg">
          <div className="mb-1 flex items-center justify-center gap-2">
            <span className="inline-block h-0.5 w-4 rounded bg-cyan-400" />
            <span className="font-medium text-cyan-300">Readiness-aware planner</span>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-left">
            <div className="text-gray-500">distance</div>
            <div className="text-right font-mono text-gray-200">{route.distanceKm.toFixed(1)} km</div>
            <div className="text-gray-500"></div>
            <div className="text-gray-500">handoffs</div>
            <div className="text-right font-mono text-gray-200">{route.handoffCount}</div>
            <div className="text-[10px] text-gray-500 italic">(tiles below {threshold.toFixed(2)})</div>
            <div className="text-gray-500">red avoided</div>
            <div className="text-right font-mono text-rose-300">{route.redTilesAvoided}</div>
            <div className="text-[10px] text-gray-500 italic">vs straight line</div>
          </div>
          <div className="mt-2 border-t border-gray-800 pt-1.5 text-[10px] text-gray-500">
            Naive straight line: {straightDistanceKm.toFixed(1)} km{" "}
            <span className="mx-1 text-gray-700">|</span>
            Planner: +{(route.distanceKm - straightDistanceKm).toFixed(1)} km to skirt risk
          </div>
          <div className="mt-0.5 text-[10px] text-gray-600">
            8-connected Dijkstra over readiness grid, synthetic demo
          </div>
          {phase === "done" && (
            <button
              onClick={() => {
                setPhase("picked_both");
                setReplayKey((k) => k + 1);
              }}
              className="mt-1.5 block w-full text-center text-[10px] text-cyan-400 hover:text-cyan-300"
            >
              Replay
            </button>
          )}
        </div>
      )}
    </>
  );
}
