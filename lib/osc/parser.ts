import type {
  Action,
  Edit,
  OsmElement,
  OsmElementType,
  OsmMember,
  OsmNodeElement,
  OsmRelationElement,
  OsmWayElement,
} from './types';

const ACTION_BLOCK_RE = /<(create|modify|delete)\b[^>]*>([\s\S]*?)<\/\1>/g;
const ELEMENT_RE =
  /<(node|way|relation)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
const ATTR_RE = /(\w+)\s*=\s*"([^"]*)"/g;
const TAG_RE = /<tag\b([^>]*)\/?>(?:<\/tag>)?/g;
const ND_RE = /<nd\b([^>]*)\/?>(?:<\/nd>)?/g;
const MEMBER_RE = /<member\b([^>]*)\/?>(?:<\/member>)?/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    out[m[1]] = decodeXml(m[2]);
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function collectTags(inner: string): Record<string, string> {
  const tags: Record<string, string> = {};
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(inner)) !== null) {
    const attrs = parseAttrs(m[1]);
    if (attrs.k !== undefined) {
      tags[attrs.k] = attrs.v ?? '';
    }
  }
  return tags;
}

function collectNds(inner: string): string[] {
  const nds: string[] = [];
  ND_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ND_RE.exec(inner)) !== null) {
    const attrs = parseAttrs(m[1]);
    if (attrs.ref !== undefined) nds.push(attrs.ref);
  }
  return nds;
}

function collectMembers(inner: string): OsmMember[] {
  const members: OsmMember[] = [];
  MEMBER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MEMBER_RE.exec(inner)) !== null) {
    const attrs = parseAttrs(m[1]);
    const t = attrs.type as OsmElementType | undefined;
    if (t === 'node' || t === 'way' || t === 'relation') {
      members.push({
        type: t,
        ref: attrs.ref ?? '',
        role: attrs.role ?? '',
      });
    }
  }
  return members;
}

function buildElement(
  type: OsmElementType,
  attrs: Record<string, string>,
  inner: string,
): OsmElement {
  const id = attrs.id ?? '';
  const version = attrs.version ? Number(attrs.version) : undefined;
  const tags = collectTags(inner);
  if (type === 'node') {
    const el: OsmNodeElement = {
      type: 'node',
      id,
      version,
      tags,
    };
    const lat = Number(attrs.lat);
    const lon = Number(attrs.lon);
    if (Number.isFinite(lat)) el.lat = lat;
    if (Number.isFinite(lon)) el.lon = lon;
    return el;
  }
  if (type === 'way') {
    const el: OsmWayElement = {
      type: 'way',
      id,
      version,
      nds: collectNds(inner),
      tags,
    };
    return el;
  }
  const rel: OsmRelationElement = {
    type: 'relation',
    id,
    version,
    members: collectMembers(inner),
    tags,
  };
  return rel;
}

function summarize(action: Action, el: OsmElement): string {
  const idLabel = `${el.type}/${el.id}`;
  if (action === 'create') {
    const headline = el.tags.name ?? el.tags.highway ?? el.tags.amenity;
    return headline ? `Create ${idLabel} (${headline})` : `Create ${idLabel}`;
  }
  if (action === 'delete') {
    return `Delete ${idLabel}${el.version ? ` v${el.version}` : ''}`;
  }
  const changed = Object.entries(el.tags)
    .slice(0, 2)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `Modify ${idLabel}${el.version ? ` v${el.version}` : ''}${changed ? ` [${changed}]` : ''}`;
}

// Deterministic creation timestamps so SSR and client render identically.
// Spaced 0-21 minutes before the pinned reference time, so SLA badges
// exercise the warn/danger thresholds without any wall-clock dependence.
const PINNED_NOW_MS = Date.UTC(2026, 4, 28, 14, 30, 0);
const AGE_OFFSETS_MIN = [1, 4, 7, 12, 18, 21, 25];

function createdAtFor(index: number): string {
  const offset = AGE_OFFSETS_MIN[index % AGE_OFFSETS_MIN.length];
  return new Date(PINNED_NOW_MS - offset * 60_000).toISOString();
}

export function parseOsmChange(xml: string): Edit[] {
  const edits: Edit[] = [];
  ACTION_BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  let editIndex = 0;
  while ((block = ACTION_BLOCK_RE.exec(xml)) !== null) {
    const action = block[1] as Action;
    const inner = block[2];
    ELEMENT_RE.lastIndex = 0;
    let elMatch: RegExpExecArray | null;
    while ((elMatch = ELEMENT_RE.exec(inner)) !== null) {
      const type = elMatch[1] as OsmElementType;
      const attrs = parseAttrs(elMatch[2]);
      const elementInner = elMatch[4] ?? '';
      const element = buildElement(type, attrs, elementInner);
      const rawXml = `<${action}>\n  ${elMatch[0]}\n</${action}>`;
      const id = `E-${String(editIndex + 1).padStart(3, '0')}`;
      edits.push({
        id,
        action,
        element,
        rawXml,
        createdAt: createdAtFor(editIndex),
        summary: summarize(action, element),
      });
      editIndex += 1;
    }
  }
  return edits;
}

export const OSC_PINNED_NOW_MS = PINNED_NOW_MS;
