'use client';

import React, { useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';

function useNoGl() {
  const [nogl] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('nogl');
  });
  return nogl;
}

function NoGlDiffPane({
  versionLabel, highlight, highlightColor, initialCenter,
}: {
  versionLabel: string;
  highlight: FeatureCollection | null;
  highlightColor: string;
  initialCenter: [number, number];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  useEffect(() => {
    const el = ref.current;
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

  // Center the view on initialCenter with a fixed metric span , keeps the two
  // panes (old/new) visually comparable side-by-side in the static capture.
  const SPAN_DEG = 0.004; // ~400m, matches zoom ~13
  const west = initialCenter[0] - SPAN_DEG;
  const east = initialCenter[0] + SPAN_DEG;
  const north = initialCenter[1] + SPAN_DEG * 0.6;
  const south = initialCenter[1] - SPAN_DEG * 0.6;

  const project = useMemo(() => {
    const sx = size.w / (east - west);
    const sy = size.h / (north - south);
    const s = Math.min(sx, sy);
    const offX = (size.w - (east - west) * s) / 2;
    const offY = (size.h - (north - south) * s) / 2;
    return (lng: number, lat: number): [number, number] => [
      offX + (lng - west) * s,
      offY + (north - lat) * s,
    ];
  }, [west, east, north, south, size.w, size.h]);

  const shapes = useMemo(() => {
    if (!highlight) return [] as React.ReactNode[];
    const out: React.ReactNode[] = [];
    highlight.features.forEach((f, i) => {
      const g = f.geometry;
      if (g.type === 'LineString') {
        const pts = (g.coordinates as [number, number][]).map(([lng, lat]) => project(lng, lat));
        out.push(
          <polyline
            key={`l${i}`}
            points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}
            stroke={highlightColor}
            strokeWidth={5}
            strokeOpacity={0.85}
            fill="none"
          />,
        );
      } else if (g.type === 'Point') {
        const [x, y] = project(...(g.coordinates as [number, number]));
        out.push(
          <circle key={`p${i}`} cx={x} cy={y} r={8} fill={highlightColor} stroke="#0f172a" strokeWidth={2} />,
        );
      }
    });
    return out;
  }, [highlight, highlightColor, project]);

  return (
    <div className="flex flex-col h-full">
      <div className="bg-gray-900 border-b border-gray-800 px-3 py-1 flex justify-between items-center h-[24px]">
        <span className="text-[10px] font-mono text-gray-400">{versionLabel}</span>
      </div>
      <div ref={ref} className="flex-1 bg-[#0a0a0a] relative">
        <svg width={size.w} height={size.h} className="block">
          <defs>
            <pattern id={`grid-${versionLabel}`} width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#1f2937" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width={size.w} height={size.h} fill={`url(#grid-${versionLabel})`} />
          {shapes}
          <text x={8} y={size.h - 8} fill="#6b7280" fontSize="9" fontFamily="monospace">
            {initialCenter[1].toFixed(4)}, {initialCenter[0].toFixed(4)} · static
          </text>
        </svg>
      </div>
    </div>
  );
}

interface DiffMapPaneProps {
  versionLabel: string;
  highlight: FeatureCollection | null;
  highlightColor: string;
  initialCenter: [number, number];
  onMove?: () => void;
}

export interface DiffMapRef {
  getMap: () => maplibregl.Map | null;
}

const HIGHLIGHT_SOURCE = 'edit-highlight';
const HIGHLIGHT_LINE_LAYER = 'edit-highlight-line';
const HIGHLIGHT_POINT_LAYER = 'edit-highlight-point';

const DiffMapPane = forwardRef<DiffMapRef, DiffMapPaneProps>(
  ({ versionLabel, highlight, highlightColor, initialCenter, onMove }, ref) => {
    const nogl = useNoGl();
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const onMoveRef = useRef<typeof onMove>(onMove);

    useImperativeHandle(ref, () => ({
      getMap: () => map.current,
    }));

    useEffect(() => {
      onMoveRef.current = onMove;
    }, [onMove]);

    useEffect(() => {
      if (nogl) return;
      if (!mapContainer.current) return;

      const instance = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8,
          sources: {
            'carto-dark': {
              type: 'raster',
              tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap contributors © CARTO',
            },
          },
          layers: [{ id: 'carto-dark-layer', type: 'raster', source: 'carto-dark' }],
        },
        center: initialCenter,
        zoom: 13,
      });
      map.current = instance;

      const handler = () => {
        onMoveRef.current?.();
      };
      instance.on('move', handler);

      instance.on('load', () => {
        instance.addSource(HIGHLIGHT_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        instance.addLayer({
          id: HIGHLIGHT_LINE_LAYER,
          type: 'line',
          source: HIGHLIGHT_SOURCE,
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: {
            'line-color': highlightColor,
            'line-width': 5,
            'line-opacity': 0.85,
          },
        });
        instance.addLayer({
          id: HIGHLIGHT_POINT_LAYER,
          type: 'circle',
          source: HIGHLIGHT_SOURCE,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 8,
            'circle-color': highlightColor,
            'circle-stroke-color': '#0f172a',
            'circle-stroke-width': 2,
          },
        });
      });

      return () => {
        instance.off('move', handler);
        instance.remove();
        map.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nogl]);

    useEffect(() => {
      if (nogl) return;
      const instance = map.current;
      if (!instance) return;
      const apply = () => {
        const src = instance.getSource(HIGHLIGHT_SOURCE) as
          | maplibregl.GeoJSONSource
          | undefined;
        if (!src) return;
        src.setData(
          highlight ?? { type: 'FeatureCollection', features: [] },
        );
        if (instance.getLayer(HIGHLIGHT_LINE_LAYER)) {
          instance.setPaintProperty(HIGHLIGHT_LINE_LAYER, 'line-color', highlightColor);
        }
        if (instance.getLayer(HIGHLIGHT_POINT_LAYER)) {
          instance.setPaintProperty(HIGHLIGHT_POINT_LAYER, 'circle-color', highlightColor);
        }
      };
      if (instance.isStyleLoaded()) apply();
      else instance.once('load', apply);
    }, [highlight, highlightColor]);

    return (
      <>
        {nogl ? (
          <NoGlDiffPane
            versionLabel={versionLabel}
            highlight={highlight}
            highlightColor={highlightColor}
            initialCenter={initialCenter}
          />
        ) : (
          <div className="flex flex-col h-full">
            <div className="bg-gray-900 border-b border-gray-800 px-3 py-1 flex justify-between items-center h-[24px]">
              <span className="text-[10px] font-mono text-gray-400">{versionLabel}</span>
            </div>
            <div ref={mapContainer} className="flex-1 bg-gray-950" />
          </div>
        )}
      </>
    );
  },
);

DiffMapPane.displayName = 'DiffMapPane';

export default DiffMapPane;
