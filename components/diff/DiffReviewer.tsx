'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  Point,
} from 'geojson';
import { asset } from '@/lib/asset';
import { OSC_PINNED_NOW_MS, parseOsmChange } from '@/lib/osc/parser';
import type { Edit, OsmNodeElement, OsmWayElement } from '@/lib/osc/types';
import {
  assignEdit,
  getEditState,
  loadReviewState,
  persistReviewState,
  transitionEdit,
} from '@/lib/review/store';
import type {
  Assignee,
  AuditEntry,
  ReviewStatus,
  ReviewStoreData,
} from '@/lib/review/types';
import DiffMapPane, { type DiffMapRef } from './DiffMapPane';
import EditCard from './EditCard';
import TopBar from '@/components/TopBar';
import AuditLogPanel from './AuditLogPanel';
import OpenLRPanel from './OpenLRPanel';
import { encodeLineLocation, bearingDeg, haversineMeters } from '@/lib/openlr/encode';
import { frcFromHighway, fowFromOsm } from '@/lib/openlr/osm-mapping';
import type { LineLocation, LocationReferencePoint } from '@/lib/openlr/types';

const ACTOR = 'alice';
const SF_CENTER: [number, number] = [-122.42, 37.78];
const STATUS_ORDER: ReviewStatus[] = [
  'pending',
  'in_review',
  'needs_info',
  'approved',
  'rejected',
];

type GeometryLookup = Map<string, Geometry>;

function buildGeometryLookup(fc: FeatureCollection): GeometryLookup {
  const map: GeometryLookup = new Map();
  for (const f of fc.features) {
    if (typeof f.id === 'string') {
      map.set(f.id, f.geometry);
    }
  }
  return map;
}

function highlightFor(
  edit: Edit,
  side: 'before' | 'after',
  lookup: GeometryLookup,
  newNodeCoords: Map<string, [number, number]>,
): FeatureCollection | null {
  const { action, element } = edit;
  const key = `${element.type}/${element.id}`;
  const features: Feature[] = [];

  const lookupGeom = (): Geometry | undefined => lookup.get(key);

  const fromNewWay = (): LineString | null => {
    if (element.type !== 'way') return null;
    const w = element as OsmWayElement;
    const coords: [number, number][] = [];
    for (const ref of w.nds) {
      const c = newNodeCoords.get(ref);
      if (c) coords.push(c);
    }
    if (coords.length < 2) return null;
    return { type: 'LineString', coordinates: coords };
  };

  const fromNewNode = (): Point | null => {
    if (element.type !== 'node') return null;
    const n = element as OsmNodeElement;
    if (n.lon === undefined || n.lat === undefined) return null;
    return { type: 'Point', coordinates: [n.lon, n.lat] };
  };

  if (action === 'create') {
    if (side === 'before') return null;
    const geom = fromNewNode() ?? fromNewWay();
    if (!geom) return null;
    features.push({ type: 'Feature', properties: {}, geometry: geom });
  } else if (action === 'delete') {
    if (side === 'after') return null;
    const geom = lookupGeom();
    if (!geom) return null;
    features.push({ type: 'Feature', properties: {}, geometry: geom });
  } else {
    const geom = lookupGeom() ?? fromNewNode();
    if (!geom) return null;
    features.push({ type: 'Feature', properties: {}, geometry: geom });
  }

  return { type: 'FeatureCollection', features };
}

function centerOfHighlight(fc: FeatureCollection | null): [number, number] | null {
  if (!fc || fc.features.length === 0) return null;
  const g = fc.features[0].geometry;
  if (g.type === 'Point') return g.coordinates as [number, number];
  if (g.type === 'LineString' && g.coordinates.length > 0) {
    return g.coordinates[0] as [number, number];
  }
  return null;
}

const ACTION_COLOR = {
  create: '#10b981',
  modify: '#eab308',
  delete: '#ef4444',
} as const;

function extractWayCoords(
  edit: Edit,
  lookup: GeometryLookup,
  newNodeCoords: Map<string, [number, number]>,
): [number, number][] | null {
  const key = `${edit.element.type}/${edit.element.id}`;
  if (edit.element.type === 'way') {
    const w = edit.element as OsmWayElement;
    if (edit.action === 'create' || edit.action === 'modify') {
      const coords: [number, number][] = [];
      for (const ref of w.nds) {
        const c = newNodeCoords.get(ref);
        if (c) coords.push(c);
      }
      if (coords.length >= 2) return coords;
    }
    const geom = lookup.get(key);
    if (geom?.type === 'LineString') return geom.coordinates as [number, number][];
  }
  return null;
}

function lineLocationFromCoords(
  coords: [number, number][],
  tags: Record<string, string>,
): LineLocation {
  const frc = frcFromHighway(tags['highway'] ?? '');
  const fow = fowFromOsm(tags);
  const lrps: LocationReferencePoint[] = [];

  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    const isLast = i === coords.length - 1;
    if (isLast) {
      lrps.push({ lon, lat, frc, fow, bearing: 0 });
    } else {
      const [nlon, nlat] = coords[i + 1];
      const bearing = bearingDeg(lon, lat, nlon, nlat);
      const dist = haversineMeters(lon, lat, nlon, nlat);
      lrps.push({ lon, lat, frc, fow, bearing, lfrcnp: frc, distanceToNext: dist });
    }
  }

  // Collapse to first + last if there are more than 2 LRPs (keep it simple)
  if (lrps.length > 2) {
    const first = lrps[0];
    const last = lrps[lrps.length - 1];
    // Update last bearing: direction from second-to-last original coord to last coord
    const prev = coords[coords.length - 2];
    const cur = coords[coords.length - 1];
    last.bearing = bearingDeg(prev[0], prev[1], cur[0], cur[1]);
    // Recompute distanceToNext for first as direct haversine to last
    first.distanceToNext = haversineMeters(first.lon, first.lat, last.lon, last.lat);
    return { lrps: [first, last] };
  }

  return { lrps };
}

const DiffReviewer: React.FC = () => {
  const [edits, setEdits] = useState<Edit[] | null>(null);
  const [store, setStore] = useState<ReviewStoreData>({ states: {}, audit: [] });
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [geomLookup, setGeomLookup] = useState<GeometryLookup>(new Map());
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mapV1Ref = useRef<DiffMapRef>(null);
  const mapV2Ref = useRef<DiffMapRef>(null);
  const isSyncing = useRef(false);

  useEffect(() => {
    // Hydration: localStorage must only run on the client to avoid SSR/client
    // drift. nowMs is pinned to OSC_PINNED_NOW_MS so SLA badges stay stable
    // regardless of real wall-clock time. The set-state-in-effect rule is
    // intentionally suppressed for this client-only hydration pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStore(loadReviewState());
    setHydrated(true);
    setNowMs(OSC_PINNED_NOW_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(asset('/data/pending_changes.osc'))
      .then((r) => {
        if (!r.ok) throw new Error(`failed to fetch .osc: ${r.status}`);
        return r.text();
      })
      .then((xml) => {
        if (cancelled) return;
        const parsed = parseOsmChange(xml);
        setEdits(parsed);
        if (parsed.length > 0) setSelectedId(parsed[0].id);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(asset('/data/sf.geojson'))
      .then((r) => r.json() as Promise<FeatureCollection>)
      .then((fc) => {
        if (cancelled) return;
        setGeomLookup(buildGeometryLookup(fc));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydrated) persistReviewState(store);
  }, [store, hydrated]);

  const newNodeCoords = useMemo(() => {
    const m = new Map<string, [number, number]>();
    if (!edits) return m;
    for (const e of edits) {
      if (e.action === 'create' && e.element.type === 'node') {
        const n = e.element as OsmNodeElement;
        if (n.lon !== undefined && n.lat !== undefined) {
          m.set(n.id, [n.lon, n.lat]);
        }
      }
    }
    return m;
  }, [edits]);

  const selected = useMemo(() => {
    if (!edits || !selectedId) return null;
    return edits.find((e) => e.id === selectedId) ?? null;
  }, [edits, selectedId]);

  const beforeFc = useMemo(
    () => (selected ? highlightFor(selected, 'before', geomLookup, newNodeCoords) : null),
    [selected, geomLookup, newNodeCoords],
  );
  const afterFc = useMemo(
    () => (selected ? highlightFor(selected, 'after', geomLookup, newNodeCoords) : null),
    [selected, geomLookup, newNodeCoords],
  );

  const focusCenter = useMemo<[number, number]>(() => {
    return (
      centerOfHighlight(afterFc) ??
      centerOfHighlight(beforeFc) ??
      SF_CENTER
    );
  }, [beforeFc, afterFc]);

  useEffect(() => {
    if (!selected) return;
    const c = centerOfHighlight(afterFc) ?? centerOfHighlight(beforeFc);
    if (!c) return;
    mapV1Ref.current?.getMap()?.easeTo({ center: c, zoom: 16, duration: 400 });
    mapV2Ref.current?.getMap()?.easeTo({ center: c, zoom: 16, duration: 400 });
  }, [selected, afterFc, beforeFc]);

  const syncMaps = useCallback((source: 'v1' | 'v2') => {
    if (isSyncing.current) return;
    const sourceMap = (source === 'v1' ? mapV1Ref : mapV2Ref).current?.getMap();
    const targetMap = (source === 'v1' ? mapV2Ref : mapV1Ref).current?.getMap();
    if (!sourceMap || !targetMap) return;
    isSyncing.current = true;
    targetMap.jumpTo({
      center: sourceMap.getCenter(),
      zoom: sourceMap.getZoom(),
      bearing: sourceMap.getBearing(),
      pitch: sourceMap.getPitch(),
    });
    isSyncing.current = false;
  }, []);

  const handleTransition = useCallback(
    (editId: string, to: ReviewStatus, comment?: string) => {
      setStore((s) => transitionEdit(s, { editId, to, actor: ACTOR, comment }));
    },
    [],
  );

  const handleAssign = useCallback((editId: string, assignee: Assignee) => {
    setStore((s) => assignEdit(s, { editId, assignee, actor: ACTOR }));
  }, []);

  const handleClearAudit = useCallback(() => {
    setStore((s) => ({ ...s, audit: [] }));
  }, []);

  const ageMinutesFor = useCallback(
    (edit: Edit): number | null => {
      if (nowMs === null) return null;
      const created = Date.parse(edit.createdAt);
      if (Number.isNaN(created)) return null;
      return (nowMs - created) / 60_000;
    },
    [nowMs],
  );

  const stats = useMemo(() => {
    if (!edits) {
      return { counts: {} as Record<ReviewStatus, number>, avgAge: null as number | null };
    }
    const counts: Record<ReviewStatus, number> = {
      pending: 0,
      in_review: 0,
      approved: 0,
      rejected: 0,
      needs_info: 0,
    };
    let ageSum = 0;
    let ageN = 0;
    for (const e of edits) {
      const s = getEditState(store, e.id).status;
      counts[s] += 1;
      const a = ageMinutesFor(e);
      if (a !== null) {
        ageSum += a;
        ageN += 1;
      }
    }
    return {
      counts,
      avgAge: ageN > 0 ? ageSum / ageN : null,
    };
  }, [edits, store, ageMinutesFor]);

  const openlrMap = useMemo(() => {
    const m = new Map<string, { b64: string; loc: LineLocation }>();
    if (!edits) return m;
    for (const edit of edits) {
      const coords = extractWayCoords(edit, geomLookup, newNodeCoords);
      if (!coords || coords.length < 2) continue;
      try {
        const loc = lineLocationFromCoords(coords, edit.element.type === 'way'
          ? (edit.element as OsmWayElement).tags
          : {});
        const b64 = encodeLineLocation(loc);
        m.set(edit.id, { b64, loc });
      } catch {
        // skip if encoding fails (e.g. degenerate geometry)
      }
    }
    return m;
  }, [edits, geomLookup, newNodeCoords]);

  if (loadError) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center text-red-400 font-mono text-sm">
        Failed to load pending_changes.osc: {loadError}
      </div>
    );
  }

  if (!edits) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center text-gray-400 font-mono text-sm">
        Parsing osmChange feed…
      </div>
    );
  }

  const highlightColor = selected ? ACTION_COLOR[selected.action] : '#6b7280';

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">
      <TopBar active="diff" />

      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex flex-wrap items-center gap-4 text-[11px] font-mono uppercase tracking-wider text-gray-400 shrink-0">
        <span className="text-gray-300">
          {edits.length} edits from pending_changes.osc
        </span>
        <span className="text-gray-700">·</span>
        {STATUS_ORDER.map((s) => (
          <span key={s}>
            {s.replace('_', ' ')}: <span className="text-gray-200">{stats.counts[s] ?? 0}</span>
          </span>
        ))}
        <span className="text-gray-700">·</span>
        <span>
          avg age:{' '}
          <span className="text-gray-200">
            {stats.avgAge === null ? '—' : `${Math.floor(stats.avgAge)} min`}
          </span>
        </span>
        <span className="ml-auto text-gray-600 normal-case tracking-normal">
          independent OSS prototype for high-stakes geospatial data quality
        </span>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 min-w-0 border-r border-gray-800">
          <div className="flex-1 min-w-0 relative">
            <DiffMapPane
              ref={mapV1Ref}
              versionLabel="before (baseline)"
              highlight={beforeFc}
              highlightColor={highlightColor}
              initialCenter={focusCenter}
              onMove={() => syncMaps('v1')}
            />
          </div>
          <div className="flex-1 min-w-0 relative border-l border-gray-800">
            <DiffMapPane
              ref={mapV2Ref}
              versionLabel="after (candidate)"
              highlight={afterFc}
              highlightColor={highlightColor}
              initialCenter={focusCenter}
              onMove={() => syncMaps('v2')}
            />
          </div>
        </div>

        <aside className="w-[380px] flex flex-col bg-gray-950 shrink-0 overflow-hidden border-l border-gray-800">
          <div className="p-3 border-b border-gray-800">
            <h2 className="text-sm font-medium text-gray-300 uppercase tracking-wide">
              Parsed edits
            </h2>
            <p className="text-[10px] font-mono text-gray-500 mt-1">
              acting as <span className="text-indigo-300">{ACTOR}</span>
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {edits.map((edit) => (
              <EditCard
                key={edit.id}
                edit={edit}
                state={getEditState(store, edit.id)}
                isSelected={selectedId === edit.id}
                ageMinutes={ageMinutesFor(edit)}
                openlrPill={openlrMap.get(edit.id)?.b64}
                onSelect={setSelectedId}
                onTransition={handleTransition}
                onAssign={handleAssign}
              />
            ))}
          </div>
          {selectedId && openlrMap.has(selectedId) ? (
            <div className="p-3 border-t border-gray-800 shrink-0">
              <OpenLRPanel
                b64={openlrMap.get(selectedId)!.b64}
                loc={openlrMap.get(selectedId)!.loc}
              />
            </div>
          ) : null}
        </aside>

        <div className="w-[300px] shrink-0">
          <AuditLogPanel
            audit={store.audit as AuditEntry[]}
            onClear={handleClearAudit}
          />
        </div>
      </div>
    </div>
  );
};

export default DiffReviewer;
