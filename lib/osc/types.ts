export type Action = 'create' | 'modify' | 'delete';

export type OsmElementType = 'node' | 'way' | 'relation';

export interface OsmMember {
  type: OsmElementType;
  ref: string;
  role: string;
}

export interface OsmNodeElement {
  type: 'node';
  id: string;
  version?: number;
  lat?: number;
  lon?: number;
  tags: Record<string, string>;
}

export interface OsmWayElement {
  type: 'way';
  id: string;
  version?: number;
  nds: string[];
  tags: Record<string, string>;
}

export interface OsmRelationElement {
  type: 'relation';
  id: string;
  version?: number;
  members: OsmMember[];
  tags: Record<string, string>;
}

export type OsmElement = OsmNodeElement | OsmWayElement | OsmRelationElement;

export interface Edit {
  id: string;
  action: Action;
  element: OsmElement;
  rawXml: string;
  createdAt: string;
  summary: string;
}
