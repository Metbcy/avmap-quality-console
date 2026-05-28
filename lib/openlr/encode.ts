import { BitWriter } from './bits';
import type { LineLocation, LocationReferencePoint } from './types';

/** Scale factor: 1 unit = 360/2^24 degrees ≈ 2.145e-5 deg ≈ 2.39m */
export const COORD_FACTOR = (1 << 24) / 360;

/** DNP step size in meters per encoded unit */
export const DNP_STEP = 58.6;

/** Number of bearing sectors (each 11.25 degrees) */
export const BEAR_SECTORS = 32;

export function degreesToInt(deg: number): number {
  return Math.round(deg * COORD_FACTOR);
}

export function intToDegrees(n: number): number {
  return n / COORD_FACTOR;
}

export function encodeBearing(deg: number): number {
  const norm = ((deg % 360) + 360) % 360;
  return Math.floor(norm / (360 / BEAR_SECTORS));
}

export function encodeDnp(meters: number): number {
  return Math.min(255, Math.max(0, Math.round(meters / DNP_STEP)));
}

/**
 * Haversine distance in meters between two WGS84 points.
 */
export function haversineMeters(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Bearing in degrees (0=north, clockwise) from point A to point B.
 */
export function bearingDeg(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1R = (lat1 * Math.PI) / 180;
  const lat2R = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2R);
  const x =
    Math.cos(lat1R) * Math.sin(lat2R) -
    Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * Write a signed 24-bit big-endian integer.
 * The 32-bit two's complement low 3 bytes are used.
 */
function writeInt24(w: BitWriter, n: number): void {
  // Mask to 24 bits two's complement
  const v = n < 0 ? n + (1 << 24) : n;
  w.write(v, 24);
}

/**
 * Write a signed 16-bit big-endian integer.
 */
function writeInt16(w: BitWriter, n: number): void {
  const v = n < 0 ? n + (1 << 16) : n;
  w.write(v, 16);
}

/** Attr1 byte: FRC(3) | FOW(3) | bear_hi(2) */
function writeAttr1(w: BitWriter, lrp: LocationReferencePoint): void {
  const bearSector = encodeBearing(lrp.bearing);
  w.write(lrp.frc, 3);
  w.write(lrp.fow, 3);
  w.write(bearSector >>> 3, 2);  // upper 2 bits of 5-bit bear sector
}

/** Attr2 byte for non-last LRP: bear_lo(3) | lfrcnp(3) | padding(2) */
function writeAttr2NonLast(w: BitWriter, lrp: LocationReferencePoint): void {
  const bearSector = encodeBearing(lrp.bearing);
  const lfrcnp = lrp.lfrcnp ?? lrp.frc;
  w.write(bearSector & 0x07, 3);  // lower 3 bits of bear sector
  w.write(lfrcnp, 3);
  w.write(0, 2);                   // padding
}

/** Attr2 byte for last LRP: bear_lo(3) | padding(5) */
function writeAttr2Last(w: BitWriter, lrp: LocationReferencePoint): void {
  const bearSector = encodeBearing(lrp.bearing);
  w.write(bearSector & 0x07, 3);
  w.write(0, 5);  // padding
}

/**
 * Encodes a LineLocation into an OpenLR base64 string (binary Line Location,
 * spec version 2). Implements the binary format from the OpenLR whitepaper v1.5,
 * Section 5 (binary encoding).
 *
 * Layout:
 *   1 byte  status (version=2, hasAttributes=1, line location flags)
 *   9 bytes first LRP  (3 lon + 3 lat + attr1 + attr2 + dnp)
 *   7 bytes each intermediate LRP  (2 dlon + 2 dlat + attr1 + attr2 + dnp)
 *   6 bytes last LRP  (2 dlon + 2 dlat + attr1 + attr2, no dnp)
 */
export function encodeLineLocation(loc: LineLocation): string {
  if (loc.lrps.length < 2) {
    throw new Error('LineLocation requires at least 2 LRPs');
  }

  const w = new BitWriter();

  // Status byte: version=2 (010), hasAttributes=1, arF0=0, isPoint=0, arF1=0, reserved=0
  w.write(0b01010000, 8);  // 0x50

  const first = loc.lrps[0];

  // First LRP — absolute coordinates
  writeInt24(w, degreesToInt(first.lon));
  writeInt24(w, degreesToInt(first.lat));
  writeAttr1(w, first);
  writeAttr2NonLast(w, first);
  w.write(encodeDnp(first.distanceToNext ?? 0), 8);

  let prevInt = { lon: degreesToInt(first.lon), lat: degreesToInt(first.lat) };

  // Intermediate LRPs (relative)
  for (let i = 1; i < loc.lrps.length - 1; i++) {
    const lrp = loc.lrps[i];
    const curInt = { lon: degreesToInt(lrp.lon), lat: degreesToInt(lrp.lat) };
    writeInt16(w, curInt.lon - prevInt.lon);
    writeInt16(w, curInt.lat - prevInt.lat);
    writeAttr1(w, lrp);
    writeAttr2NonLast(w, lrp);
    w.write(encodeDnp(lrp.distanceToNext ?? 0), 8);
    prevInt = curInt;
  }

  // Last LRP — relative, no DNP
  const last = loc.lrps[loc.lrps.length - 1];
  const lastInt = { lon: degreesToInt(last.lon), lat: degreesToInt(last.lat) };
  writeInt16(w, lastInt.lon - prevInt.lon);
  writeInt16(w, lastInt.lat - prevInt.lat);
  writeAttr1(w, last);
  writeAttr2Last(w, last);

  const bytes = w.toBytes();

  // Base64 using btoa (browser + Node 16+)
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
