export interface OsmNode {
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

export interface OsmWay {
  id: string;
  nodeRefs: string[];
  tags: Record<string, string>;
}

export interface OsmRelationMember {
  type: "node" | "way" | "relation";
  ref: string;
  role: string;
}

export interface OsmRelation {
  id: string;
  members: OsmRelationMember[];
  tags: Record<string, string>;
}

export interface Lanelet {
  id: string;
  leftWayId: string;
  rightWayId: string;
  regulatoryElementIds: string[];
  tags: Record<string, string>;
}

export interface RegulatoryElement {
  id: string;
  subtype: string;
  refLineWayIds: string[];
  refersWayIds: string[];
  tags: Record<string, string>;
}

export interface Lanelet2Map {
  nodes: Map<string, OsmNode>;
  ways: Map<string, OsmWay>;
  relations: Map<string, OsmRelation>;
  lanelets: Lanelet[];
  regulatoryElements: RegulatoryElement[];
  bbox: [number, number, number, number];
}
