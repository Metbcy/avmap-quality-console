import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
  Position,
} from "geojson";
import type { Lanelet2Map, OsmWay } from "./types";

export interface LaneletPolygonProperties {
  lanelet_id: string;
  subtype: string;
  location: string;
  one_way: string;
  speed_limit: string;
  region: string;
}

export interface StopLineProperties {
  regulatory_element_id: string;
  way_id: string;
  subtype: string;
}

export interface TrafficLightProperties {
  regulatory_element_id: string;
  way_id: string;
}

export interface BoundaryProperties {
  way_id: string;
  subtype: string;
  type: string;
}

export interface LaneletGeoJSON {
  lanelets: FeatureCollection<Polygon, LaneletPolygonProperties>;
  boundaries: FeatureCollection<LineString, BoundaryProperties>;
  stopLines: FeatureCollection<LineString, StopLineProperties>;
  trafficLights: FeatureCollection<Point, TrafficLightProperties>;
  stopLineCount: number;
  trafficLightCount: number;
}

function wayToCoords(way: OsmWay | undefined, map: Lanelet2Map): Position[] {
  if (!way) return [];
  const coords: Position[] = [];
  for (const ref of way.nodeRefs) {
    const n = map.nodes.get(ref);
    if (n) coords.push([n.lon, n.lat]);
  }
  return coords;
}

function wayCentroid(way: OsmWay | undefined, map: Lanelet2Map): Position | null {
  const coords = wayToCoords(way, map);
  if (coords.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const c of coords) {
    lon += c[0];
    lat += c[1];
  }
  return [lon / coords.length, lat / coords.length];
}

export function buildLaneletGeoJSON(map: Lanelet2Map): LaneletGeoJSON {
  const laneletFeatures: Feature<Polygon, LaneletPolygonProperties>[] = [];
  const boundaryFeatures: Feature<LineString, BoundaryProperties>[] = [];
  const boundaryWayIds = new Set<string>();

  for (const ll of map.lanelets) {
    const left = map.ways.get(ll.leftWayId);
    const right = map.ways.get(ll.rightWayId);
    const leftCoords = wayToCoords(left, map);
    const rightCoords = wayToCoords(right, map);
    if (leftCoords.length < 2 || rightCoords.length < 2) continue;

    const ring: Position[] = [...leftCoords, ...rightCoords.slice().reverse()];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }

    laneletFeatures.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        lanelet_id: ll.id,
        subtype: ll.tags["subtype"] ?? "",
        location: ll.tags["location"] ?? "",
        one_way: ll.tags["one_way"] ?? "",
        speed_limit: ll.tags["speed_limit"] ?? "",
        region: ll.tags["region"] ?? "",
      },
    });

    boundaryWayIds.add(ll.leftWayId);
    boundaryWayIds.add(ll.rightWayId);
  }

  for (const wayId of boundaryWayIds) {
    const way = map.ways.get(wayId);
    const coords = wayToCoords(way, map);
    if (coords.length < 2 || !way) continue;
    boundaryFeatures.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        way_id: way.id,
        subtype: way.tags["subtype"] ?? "",
        type: way.tags["type"] ?? "",
      },
    });
  }

  const stopLineFeatures: Feature<LineString, StopLineProperties>[] = [];
  const trafficLightFeatures: Feature<Point, TrafficLightProperties>[] = [];
  const stopLineKeys = new Set<string>();
  const lightKeys = new Set<string>();

  for (const re of map.regulatoryElements) {
    if (re.subtype === "traffic_light" || re.subtype === "stop_line") {
      for (const wid of re.refLineWayIds) {
        const key = `${re.id}:${wid}`;
        if (stopLineKeys.has(key)) continue;
        stopLineKeys.add(key);
        const coords = wayToCoords(map.ways.get(wid), map);
        if (coords.length < 2) continue;
        stopLineFeatures.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {
            regulatory_element_id: re.id,
            way_id: wid,
            subtype: re.subtype,
          },
        });
      }
    }
    if (re.subtype === "traffic_light") {
      for (const wid of re.refersWayIds) {
        const key = `${re.id}:${wid}`;
        if (lightKeys.has(key)) continue;
        lightKeys.add(key);
        const c = wayCentroid(map.ways.get(wid), map);
        if (!c) continue;
        trafficLightFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: c },
          properties: {
            regulatory_element_id: re.id,
            way_id: wid,
          },
        });
      }
    }
  }

  return {
    lanelets: { type: "FeatureCollection", features: laneletFeatures },
    boundaries: { type: "FeatureCollection", features: boundaryFeatures },
    stopLines: { type: "FeatureCollection", features: stopLineFeatures },
    trafficLights: { type: "FeatureCollection", features: trafficLightFeatures },
    stopLineCount: stopLineFeatures.length,
    trafficLightCount: trafficLightFeatures.length,
  };
}
