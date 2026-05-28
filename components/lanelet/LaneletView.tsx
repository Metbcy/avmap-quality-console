"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { parseLanelet2Osm } from "@/lib/lanelet2/parser";
import { buildLaneletGeoJSON, type LaneletPolygonProperties } from "@/lib/lanelet2/toGeoJSON";
import LaneletSidebar from "./LaneletSidebar";

const LaneletMap = dynamic(() => import("./LaneletMap"), { ssr: false });

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      data: ReturnType<typeof buildLaneletGeoJSON>;
      bbox: [number, number, number, number];
      laneletCount: number;
      regulatoryElementCount: number;
    };

export default function LaneletView() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selected, setSelected] = useState<LaneletPolygonProperties | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/lanelet2_mapping_example.osm")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((xml) => {
        const map = parseLanelet2Osm(xml);
        const data = buildLaneletGeoJSON(map);
        if (cancelled) return;
        setState({
          kind: "ready",
          data,
          bbox: map.bbox,
          laneletCount: map.lanelets.length,
          regulatoryElementCount: map.regulatoryElements.length,
        });
        const bboxStr = `[${map.bbox.map((n) => n.toFixed(6)).join(", ")}]`;
        console.log(
          `Parsed ${map.lanelets.length} lanelets, ${map.regulatoryElements.length} regulatory elements. Bbox: ${bboxStr}`,
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    if (state.kind !== "ready") {
      return {
        laneletCount: 0,
        regulatoryElementCount: 0,
        stopLineCount: 0,
        trafficLightCount: 0,
        bbox: [0, 0, 0, 0] as [number, number, number, number],
      };
    }
    return {
      laneletCount: state.laneletCount,
      regulatoryElementCount: state.regulatoryElementCount,
      stopLineCount: state.data.stopLineCount,
      trafficLightCount: state.data.trafficLightCount,
      bbox: state.bbox,
    };
  }, [state]);

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <LaneletSidebar
          stats={stats}
          selected={selected}
          onClear={() => setSelected(null)}
        />
        <div className="relative flex-1">
          {state.kind === "ready" ? (
            <LaneletMap
              data={state.data}
              bbox={state.bbox}
              selectedLaneletId={selected?.lanelet_id ?? null}
              onLaneletClick={(p) => setSelected(p)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
              {state.kind === "loading"
                ? "Loading Lanelet2 sample..."
                : `Failed to load sample: ${state.message}`}
            </div>
          )}
        </div>
      </div>
      <StatusBar stats={stats} ready={state.kind === "ready"} />
    </div>
  );
}

function TopBar() {
  return (
    <div className="flex h-12 items-center justify-between border-b border-gray-800 bg-gray-950 px-4">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-sm bg-indigo-400" />
        <span className="text-sm font-medium tracking-tight">AV Map Quality Console</span>
      </div>
      <nav className="flex gap-1 text-xs">
        <Link href="/" className="rounded px-2.5 py-1 text-gray-400 hover:text-gray-200">
          Triage
        </Link>
        <Link href="/diff" className="rounded px-2.5 py-1 text-gray-400 hover:text-gray-200">
          Diff
        </Link>
        <Link href="/lanelet" className="rounded bg-gray-800 px-2.5 py-1 text-indigo-300">
          Lanelet2
        </Link>
      </nav>
    </div>
  );
}

function StatusBar({
  stats,
  ready,
}: {
  stats: {
    laneletCount: number;
    regulatoryElementCount: number;
    bbox: [number, number, number, number];
  };
  ready: boolean;
}) {
  return (
    <div className="flex h-10 items-center gap-6 border-t border-gray-800 bg-gray-950 px-4 text-xs">
      <Stat label="lanelets" value={stats.laneletCount.toString()} />
      <Stat label="regulatory elements" value={stats.regulatoryElementCount.toString()} />
      <div className="ml-auto flex items-center gap-2 text-gray-500">
        <span className="text-[10px] uppercase tracking-widest">source</span>
        <span className="font-mono text-gray-300">fzi/Lanelet2 mapping_example.osm</span>
        <span
          className={`ml-2 inline-block h-1.5 w-1.5 rounded-full ${
            ready ? "bg-emerald-400" : "bg-gray-600"
          }`}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
      <span className="font-mono text-gray-200">{value}</span>
    </div>
  );
}
