import type {
  Lanelet,
  Lanelet2Map,
  OsmNode,
  OsmRelation,
  OsmRelationMember,
  OsmWay,
  RegulatoryElement,
} from "./types";

function readTags(el: Element): Record<string, string> {
  const tags: Record<string, string> = {};
  const tagEls = el.getElementsByTagName("tag");
  for (let i = 0; i < tagEls.length; i++) {
    const t = tagEls[i];
    const k = t.getAttribute("k");
    const v = t.getAttribute("v");
    if (k !== null && v !== null) tags[k] = v;
  }
  return tags;
}

export function parseLanelet2Osm(xml: string): Lanelet2Map {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error("Failed to parse Lanelet2 OSM XML");
  }

  const nodes = new Map<string, OsmNode>();
  const ways = new Map<string, OsmWay>();
  const relations = new Map<string, OsmRelation>();

  const nodeEls = doc.getElementsByTagName("node");
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;

  for (let i = 0; i < nodeEls.length; i++) {
    const el = nodeEls[i];
    const id = el.getAttribute("id");
    const latStr = el.getAttribute("lat");
    const lonStr = el.getAttribute("lon");
    if (id === null || latStr === null || lonStr === null) continue;
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    nodes.set(id, { id, lat, lon, tags: readTags(el) });
    if (lat < minLat) minLat = lat;
    if (lon < minLon) minLon = lon;
    if (lat > maxLat) maxLat = lat;
    if (lon > maxLon) maxLon = lon;
  }

  const wayEls = doc.getElementsByTagName("way");
  for (let i = 0; i < wayEls.length; i++) {
    const el = wayEls[i];
    const id = el.getAttribute("id");
    if (id === null) continue;
    const ndEls = el.getElementsByTagName("nd");
    const nodeRefs: string[] = [];
    for (let j = 0; j < ndEls.length; j++) {
      const ref = ndEls[j].getAttribute("ref");
      if (ref !== null) nodeRefs.push(ref);
    }
    ways.set(id, { id, nodeRefs, tags: readTags(el) });
  }

  const relEls = doc.getElementsByTagName("relation");
  for (let i = 0; i < relEls.length; i++) {
    const el = relEls[i];
    const id = el.getAttribute("id");
    if (id === null) continue;
    const memberEls = el.getElementsByTagName("member");
    const members: OsmRelationMember[] = [];
    for (let j = 0; j < memberEls.length; j++) {
      const m = memberEls[j];
      const type = m.getAttribute("type");
      const ref = m.getAttribute("ref");
      const role = m.getAttribute("role") ?? "";
      if ((type === "node" || type === "way" || type === "relation") && ref !== null) {
        members.push({ type, ref, role });
      }
    }
    relations.set(id, { id, members, tags: readTags(el) });
  }

  const lanelets: Lanelet[] = [];
  const regulatoryElements: RegulatoryElement[] = [];

  for (const rel of relations.values()) {
    const type = rel.tags["type"];
    if (type === "lanelet") {
      let leftWayId: string | null = null;
      let rightWayId: string | null = null;
      const regulatoryElementIds: string[] = [];
      for (const m of rel.members) {
        if (m.type === "way" && m.role === "left") leftWayId = m.ref;
        else if (m.type === "way" && m.role === "right") rightWayId = m.ref;
        else if (m.type === "relation" && m.role === "regulatory_element") {
          regulatoryElementIds.push(m.ref);
        }
      }
      if (leftWayId !== null && rightWayId !== null) {
        lanelets.push({
          id: rel.id,
          leftWayId,
          rightWayId,
          regulatoryElementIds,
          tags: rel.tags,
        });
      }
    } else if (type === "regulatory_element") {
      const refLineWayIds: string[] = [];
      const refersWayIds: string[] = [];
      for (const m of rel.members) {
        if (m.type !== "way") continue;
        if (m.role === "ref_line") refLineWayIds.push(m.ref);
        else if (m.role === "refers") refersWayIds.push(m.ref);
      }
      regulatoryElements.push({
        id: rel.id,
        subtype: rel.tags["subtype"] ?? "",
        refLineWayIds,
        refersWayIds,
        tags: rel.tags,
      });
    }
  }

  const bbox: [number, number, number, number] = Number.isFinite(minLat)
    ? [minLon, minLat, maxLon, maxLat]
    : [0, 0, 0, 0];

  return { nodes, ways, relations, lanelets, regulatoryElements, bbox };
}
