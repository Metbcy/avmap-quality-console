"use client";

import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import { asset } from "@/lib/asset";
import {
  generateTiles,
  filterTilesToRoads,
  indexFlagsByTile,
  tileWithFlagScore,
  type CityId,
  type TileCollection,
} from "@/lib/scoring";
import type { Flag } from "@/lib/validators";
import TopBar from "@/components/TopBar";
import { computeKPIs, type CoverageKPIs } from "@/lib/kpi";
import CityCoverageCard from "@/components/CityCoverageCard";

const THRESHOLD = 0.75;

interface CityData {
  id: CityId;
  label: string;
  kpis: CoverageKPIs | null;
}

export default function CoveragePage() {
  const [cities, setCities] = useState<CityData[]>([
    { id: "sf", label: "San Francisco", kpis: null },
    { id: "mv", label: "Mountain View", kpis: null },
  ]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCityData(cityId: CityId) {
      try {
        const [roadsRes, flagsRes] = await Promise.all([
          fetch(asset(`/data/${cityId}.geojson`)),
          fetch(asset(`/data/${cityId}.flags.json`)),
        ]);

        const roads: FeatureCollection = roadsRes.ok
          ? await roadsRes.json()
          : { type: "FeatureCollection", features: [] };
        
        const flagsData: FeatureCollection = flagsRes.ok
          ? await flagsRes.json()
          : { type: "FeatureCollection", features: [] };
        
        const flags = flagsData.features as Flag[];

        const baseTiles = generateTiles(cityId);
        const filteredTiles = filterTilesToRoads(baseTiles, roads);
        const flagsByTile = indexFlagsByTile(filteredTiles, flags);

        const tiles: TileCollection = {
          type: "FeatureCollection",
          features: filteredTiles.features.map((t) =>
            tileWithFlagScore(t, flagsByTile.get(t.properties.tile_id) ?? []),
          ),
        };

        return computeKPIs(tiles, flags, THRESHOLD);
      } catch (err) {
        console.error(`Failed to load data for ${cityId}`, err);
        return null;
      }
    }

    async function init() {
      const [sfKpis, mvKpis] = await Promise.all([
        loadCityData("sf"),
        loadCityData("mv"),
      ]);

      setCities([
        { id: "sf", label: "San Francisco", kpis: sfKpis },
        { id: "mv", label: "Mountain View", kpis: mvKpis },
      ]);
      setLoading(false);
    }

    init();
  }, []);

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      <TopBar active="coverage" />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-100 text-center">Multi-city Coverage Comparison</h1>
          <p className="mt-2 text-center text-gray-400">
            At-a-glance readiness metrics across active and upcoming deployment regions.
          </p>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              <span className="text-sm font-medium text-gray-500 uppercase tracking-widest">Loading city data...</span>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-7xl">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {cities.map((city) => (
                <CityCoverageCard
                  key={city.id}
                  cityLabel={city.label}
                  kpis={city.kpis ?? undefined}
                />
              ))}
              <CityCoverageCard cityLabel="Phoenix" comingSoon />
              <CityCoverageCard cityLabel="Los Angeles" comingSoon />
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-800 bg-gray-950 px-6 py-4 text-[10px] text-gray-500">
        <div className="mx-auto max-w-7xl flex justify-between items-center">
          <span>Fixed readiness threshold: {THRESHOLD.toFixed(2)}</span>
          <span>Last updated: {new Date().toLocaleDateString()}</span>
        </div>
      </footer>
    </div>
  );
}
