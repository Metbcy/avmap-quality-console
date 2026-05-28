import { describe, it, expect } from 'vitest';
import { parseOsmChange } from '../parser';
import type { OsmNodeElement, OsmWayElement } from '../types';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<osmChange version="0.6" generator="vitest">
  <create>
    <node id="-1" lon="-122.4" lat="37.78"/>
    <node id="-2" lon="-122.41" lat="37.79"/>
    <way id="-1">
      <nd ref="-1"/>
      <nd ref="-2"/>
      <tag k="highway" v="residential"/>
      <tag k="name" v="Test Way"/>
    </way>
  </create>
  <modify>
    <way id="42" version="3">
      <nd ref="100"/>
      <nd ref="101"/>
      <tag k="maxspeed" v="25 mph"/>
    </way>
  </modify>
  <delete>
    <node id="999" version="1"/>
  </delete>
</osmChange>`;

describe('parseOsmChange', () => {
  it('parses create, modify, and delete edits in order', () => {
    const edits = parseOsmChange(SAMPLE);
    expect(edits).toHaveLength(5);
    expect(edits.map((e) => e.action)).toEqual([
      'create',
      'create',
      'create',
      'modify',
      'delete',
    ]);
  });

  it('parses node create with lat/lon attributes', () => {
    const edits = parseOsmChange(SAMPLE);
    const createNode = edits[0];
    expect(createNode.action).toBe('create');
    expect(createNode.element.type).toBe('node');
    const node = createNode.element as OsmNodeElement;
    expect(node.id).toBe('-1');
    expect(node.lon).toBeCloseTo(-122.4);
    expect(node.lat).toBeCloseTo(37.78);
  });

  it('parses way create with nd refs and tags', () => {
    const edits = parseOsmChange(SAMPLE);
    const createWay = edits[2];
    expect(createWay.element.type).toBe('way');
    const way = createWay.element as OsmWayElement;
    expect(way.nds).toEqual(['-1', '-2']);
    expect(way.tags).toEqual({
      highway: 'residential',
      name: 'Test Way',
    });
  });

  it('parses modify with version and tags', () => {
    const edits = parseOsmChange(SAMPLE);
    const mod = edits[3];
    expect(mod.action).toBe('modify');
    expect(mod.element.version).toBe(3);
    expect(mod.element.tags.maxspeed).toBe('25 mph');
  });

  it('parses delete element with id and version', () => {
    const edits = parseOsmChange(SAMPLE);
    const del = edits[4];
    expect(del.action).toBe('delete');
    expect(del.element.id).toBe('999');
    expect(del.element.version).toBe(1);
  });

  it('captures raw XML for each edit', () => {
    const edits = parseOsmChange(SAMPLE);
    expect(edits[3].rawXml).toContain('<modify>');
    expect(edits[3].rawXml).toContain('id="42"');
    expect(edits[4].rawXml).toContain('<delete>');
  });

  it('produces deterministic ISO createdAt timestamps', () => {
    const a = parseOsmChange(SAMPLE);
    const b = parseOsmChange(SAMPLE);
    expect(a.map((e) => e.createdAt)).toEqual(b.map((e) => e.createdAt));
  });
});
