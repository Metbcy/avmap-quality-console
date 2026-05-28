import { FRC, FOW, type FRCValue, type FOWValue } from './types';

/**
 * Maps an OSM highway tag value to OpenLR Functional Road Class.
 * FRC 0 = most important, 7 = least important / undefined.
 */
export function frcFromHighway(highway: string): FRCValue {
  switch (highway) {
    case 'motorway':
    case 'motorway_link':
      return FRC.MAIN_ROAD;
    case 'trunk':
    case 'trunk_link':
      return FRC.FIRST_CLASS;
    case 'primary':
    case 'primary_link':
      return FRC.SECOND_CLASS;
    case 'secondary':
    case 'secondary_link':
      return FRC.THIRD_CLASS;
    case 'tertiary':
    case 'tertiary_link':
      return FRC.FOURTH_CLASS;
    case 'residential':
    case 'unclassified':
      return FRC.FIFTH_CLASS;
    case 'service':
    case 'living_street':
    case 'pedestrian':
      return FRC.SIXTH_CLASS;
    default:
      return FRC.OTHER;
  }
}

/**
 * Maps OSM tags to OpenLR Form of Way.
 */
export function fowFromOsm(tags: Record<string, string>): FOWValue {
  const hw = tags['highway'] ?? '';
  if (hw === 'motorway') return FOW.MOTORWAY;
  if (tags['junction'] === 'roundabout' || hw === 'roundabout') return FOW.ROUNDABOUT;
  if (
    hw.endsWith('_link') ||
    hw === 'motorway_link' ||
    hw === 'trunk_link' ||
    hw === 'primary_link' ||
    hw === 'secondary_link' ||
    hw === 'tertiary_link'
  ) {
    return FOW.SLIP_ROAD;
  }
  if (hw === 'trunk' || hw === 'primary') return FOW.MULTIPLE_CARRIAGEWAY;
  if (
    hw === 'secondary' ||
    hw === 'tertiary' ||
    hw === 'residential' ||
    hw === 'unclassified' ||
    hw === 'service' ||
    hw === 'living_street'
  ) {
    return FOW.SINGLE_CARRIAGEWAY;
  }
  return FOW.OTHER;
}
