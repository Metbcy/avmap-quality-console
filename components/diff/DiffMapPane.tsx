'use client';

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';

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
    }, []);

    useEffect(() => {
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
      <div className="flex flex-col h-full">
        <div className="bg-gray-900 border-b border-gray-800 px-3 py-1 flex justify-between items-center h-[24px]">
          <span className="text-[10px] font-mono text-gray-400">{versionLabel}</span>
        </div>
        <div ref={mapContainer} className="flex-1 bg-gray-950" />
      </div>
    );
  },
);

DiffMapPane.displayName = 'DiffMapPane';

export default DiffMapPane;
