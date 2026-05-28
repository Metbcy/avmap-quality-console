import { BitReader } from './bits';
import type { FRCValue, FOWValue, LineLocation, LocationReferencePoint } from './types';
import { COORD_FACTOR, DNP_STEP, BEAR_SECTORS } from './encode';

const STATUS_VERSION_MASK = 0b11100000;
const STATUS_HAS_ATTRS_BIT = 0b00010000;
const EXPECTED_VERSION = 2 << 5;  // 0x40

function intToDegrees(n: number): number {
  return n / COORD_FACTOR;
}

function decodeBearing(sector: number): number {
  return (sector * 360) / BEAR_SECTORS + (360 / BEAR_SECTORS / 2);
}

function decodeDnp(raw: number): number {
  return raw * DNP_STEP;
}

/**
 * Decodes an OpenLR binary Line Location base64 string back to a LineLocation.
 * Symmetric inverse of encodeLineLocation.
 */
export function decodeLineLocation(b64: string): LineLocation {
  const bin = atob(b64);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);

  const r = new BitReader(raw);

  // Status byte
  const status = r.read(8);
  if ((status & STATUS_VERSION_MASK) !== EXPECTED_VERSION) {
    throw new Error(`Unsupported OpenLR version: ${(status & STATUS_VERSION_MASK) >>> 5}`);
  }
  if (!(status & STATUS_HAS_ATTRS_BIT)) {
    throw new Error('OpenLR data has no attributes');
  }

  // Determine number of LRPs from total byte count.
  // Total bytes = 1 + 9 + (n-2)*7 + 6  (for n >= 2)
  // => n = (totalBytes - 1 - 9 - 6) / 7 + 2 = (totalBytes - 10) / 7 + 2
  const total = raw.length;
  if (total < 16) {
    throw new Error(`Buffer too short for a 2-LRP line location: ${total} bytes`);
  }
  const nIntermediate = (total - 16) / 7;
  if (!Number.isInteger(nIntermediate) || nIntermediate < 0) {
    throw new Error(`Unexpected buffer length ${total} for line location`);
  }
  const nLrps = 2 + nIntermediate;

  // --- First LRP (absolute) ---
  const lonInt = r.readSigned(24);
  const latInt = r.readSigned(24);
  const attr1First = r.read(8);
  const attr2First = r.read(8);
  const dnpFirst = r.read(8);

  const frcFirst = ((attr1First >>> 5) & 0x07) as FRCValue;
  const fowFirst = ((attr1First >>> 2) & 0x07) as FOWValue;
  const bearSecFirst = ((attr1First & 0x03) << 3) | (attr2First >>> 5);
  const lfrcnpFirst = ((attr2First >>> 2) & 0x07) as FRCValue;

  const lrps: LocationReferencePoint[] = [];
  lrps.push({
    lon: intToDegrees(lonInt),
    lat: intToDegrees(latInt),
    frc: frcFirst,
    fow: fowFirst,
    bearing: decodeBearing(bearSecFirst),
    lfrcnp: lfrcnpFirst,
    distanceToNext: decodeDnp(dnpFirst),
  });

  let prevLonInt = lonInt;
  let prevLatInt = latInt;

  // --- Intermediate LRPs (relative) ---
  for (let i = 0; i < nIntermediate; i++) {
    const dLon = r.readSigned(16);
    const dLat = r.readSigned(16);
    const a1 = r.read(8);
    const a2 = r.read(8);
    const dnp = r.read(8);

    const curLonInt = prevLonInt + dLon;
    const curLatInt = prevLatInt + dLat;

    const frc = ((a1 >>> 5) & 0x07) as FRCValue;
    const fow = ((a1 >>> 2) & 0x07) as FOWValue;
    const bearSec = ((a1 & 0x03) << 3) | (a2 >>> 5);
    const lfrcnp = ((a2 >>> 2) & 0x07) as FRCValue;

    lrps.push({
      lon: intToDegrees(curLonInt),
      lat: intToDegrees(curLatInt),
      frc,
      fow,
      bearing: decodeBearing(bearSec),
      lfrcnp,
      distanceToNext: decodeDnp(dnp),
    });

    prevLonInt = curLonInt;
    prevLatInt = curLatInt;
  }

  // --- Last LRP (relative, no DNP) ---
  const dLonLast = r.readSigned(16);
  const dLatLast = r.readSigned(16);
  const a1Last = r.read(8);
  const a2Last = r.read(8);

  const lastLonInt = prevLonInt + dLonLast;
  const lastLatInt = prevLatInt + dLatLast;

  const frcLast = ((a1Last >>> 5) & 0x07) as FRCValue;
  const fowLast = ((a1Last >>> 2) & 0x07) as FOWValue;
  const bearSecLast = ((a1Last & 0x03) << 3) | (a2Last >>> 5);

  lrps.push({
    lon: intToDegrees(lastLonInt),
    lat: intToDegrees(lastLatInt),
    frc: frcLast,
    fow: fowLast,
    bearing: decodeBearing(bearSecLast),
  });

  if (lrps.length !== nLrps) {
    throw new Error(`Expected ${nLrps} LRPs, decoded ${lrps.length}`);
  }

  return { lrps };
}
