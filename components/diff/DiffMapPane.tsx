'use client';

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapDiff, DiffStatus } from '@/lib/diffs';
import { FeatureCollection } from 'geojson';

interface DiffMapPaneProps {
  versionLabel: string;
  geojson: FeatureCollection;
  diffs: MapDiff[];
  diffStates: Record<string, DiffStatus>;
  isV2: boolean;
  onMove?: (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => void;
}

export interface DiffMapRef {
  getMap: () => maplibregl.Map | null;
}

const DiffMapPane = forwardRef<DiffMapRef, DiffMapPaneProps>(({
  versionLabel,
  geojson,
  diffs,
  diffStates,
  isV2,
  onMove
}, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useImperativeHandle(ref, () => ({
    getMap: () => map.current
  }));

  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
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
        layers: [
          {
            id: 'carto-dark-layer',
            type: 'raster',
            source: 'carto-dark',
          },
        ],
      },
      center: [-122.08, 37.39],
      zoom: 13,
    });

    map.current.on('load', () => {
      if (!map.current) return;

      // Add road network
      map.current.addSource('roads', {
        type: 'geojson',
        data: geojson,
      });

      map.current.addLayer({
        id: 'roads-layer',
        type: 'line',
        source: 'roads',
        paint: {
          'line-color': '#6b7280',
          'line-width': 1,
        },
      });

      // Add diff sources and layers
      setupDiffLayers(map.current, diffs, isV2);
    });

    if (onMove) {
      map.current.on('move', onMove);
    }

    return () => {
      if (onMove) {
        map.current?.off('move', onMove);
      }
      map.current?.remove();
    };
  }, [geojson, isV2, diffs, onMove]); // Added missing dependencies

  // Update diff layers when diffStates change
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    updateDiffStyles(map.current, diffs, diffStates);
  }, [diffStates, diffs]);

  return (
    <div className="flex flex-col h-full border-r border-gray-800 last:border-r-0">
      <div className="bg-gray-900 border-b border-gray-800 px-3 py-1 flex justify-between items-center h-[24px]">
        <span className={`text-[10px] font-mono ${isV2 ? 'text-indigo-300' : 'text-gray-400'}`}>
          {versionLabel}
        </span>
      </div>
      <div ref={mapContainer} className="flex-1 bg-gray-950" />
    </div>
  );
});

DiffMapPane.displayName = 'DiffMapPane';

function setupDiffLayers(map: maplibregl.Map, diffs: MapDiff[], isV2: boolean) {
  diffs.forEach((diff) => {
    const sourceId = `diff-${diff.id}`;
    const geometry = isV2 ? diff.geometryV2 : diff.geometryV1;

    if (!geometry) return;

    if (diff.kind === 'new_lane' && isV2) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: geometry as number[][],
          },
        },
      });
      map.addLayer({
        id: `${sourceId}-layer`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#ef4444',
          'line-width': 4,
        },
      });
    } else if (diff.kind === 'moved_crosswalk') {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: geometry as number[][],
          },
        },
      });
      map.addLayer({
        id: `${sourceId}-layer`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#eab308',
          'line-width': 3,
          'line-dasharray': isV2 ? [] : [2, 2],
        },
      });
    } else if (diff.kind === 'removed_stop_sign' && !isV2) {
      // Point
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: geometry as number[],
          },
        },
      });
      
      // Circle layer
      map.addLayer({
        id: `${sourceId}-circle`,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 6,
          'circle-color': '#ef4444',
        },
      });

      // Strikethrough line
      const pt = geometry as number[];
      const offset = 0.0001;
      map.addSource(`${sourceId}-strike`, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [pt[0] - offset, pt[1] - offset],
              [pt[0] + offset, pt[1] + offset],
            ],
          },
        },
      });
      map.addLayer({
        id: `${sourceId}-strike-layer`,
        type: 'line',
        source: `${sourceId}-strike`,
        paint: {
          'line-color': '#ffffff',
          'line-width': 1,
        },
      });
    }
  });
}

function updateDiffStyles(map: maplibregl.Map, diffs: MapDiff[], diffStates: Record<string, DiffStatus>) {
  diffs.forEach((diff) => {
    const status = diffStates[diff.id] || 'pending';
    const sourceId = `diff-${diff.id}`;
    
    let layerIds = [`${sourceId}-layer`];
    if (diff.kind === 'removed_stop_sign') {
      layerIds = [`${sourceId}-circle`, `${sourceId}-strike-layer`];
    }

    layerIds.forEach(layerId => {
      if (map.getLayer(layerId)) {
        if (status === 'approved') {
          map.setPaintProperty(layerId, diff.kind === 'removed_stop_sign' && layerId.includes('circle') ? 'circle-color' : 'line-color', '#10b981');
          map.setPaintProperty(layerId, layerId.includes('circle') ? 'circle-opacity' : 'line-opacity', 1);
        } else if (status === 'rejected') {
          map.setPaintProperty(layerId, diff.kind === 'removed_stop_sign' && layerId.includes('circle') ? 'circle-color' : 'line-color', '#6b7280');
          map.setPaintProperty(layerId, layerId.includes('circle') ? 'circle-opacity' : 'line-opacity', 0.25);
        } else {
          // Reset to original
          const originalColor = (diff.kind === 'new_lane' || diff.kind === 'removed_stop_sign') ? '#ef4444' : '#eab308';
          map.setPaintProperty(layerId, diff.kind === 'removed_stop_sign' && layerId.includes('circle') ? 'circle-color' : 'line-color', originalColor);
          map.setPaintProperty(layerId, layerId.includes('circle') ? 'circle-opacity' : 'line-opacity', 1);
        }
      }
    });
  });
}


export default DiffMapPane;
