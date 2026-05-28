import { describe, expect, it } from 'vitest';
import { encodeLineLocation } from '../../lib/openlr/encode';
import { FRC, FOW } from '../../lib/openlr/types';
import type { LineLocation } from '../../lib/openlr/types';

/**
 * Canonical example — hand-verified byte-by-byte.
 *
 * LRP1: lon=0.0, lat=0.0, FRC=3, FOW=3, bear=0 deg (sector 0), LFRCNP=3, dist=586.0m
 * LRP2: lon=0.0, lat=0.009, FRC=3, FOW=3, bear=0 deg (sector 0)
 *
 * Bytes computed manually:
 *   [0] 0x50  status (version=2, hasAttributes=1, line)
 *   [1-3] 0x00 0x00 0x00  LRP1 lon  (round(0.0 * 2^24/360) = 0)
 *   [4-6] 0x00 0x00 0x00  LRP1 lat  (0)
 *   [7]  0x6C  attr1: FRC=3(011), FOW=3(011), bear_hi=0(00)  => 01101100
 *   [8]  0x0C  attr2: bear_lo=0(000), LFRCNP=3(011), pad=0(00) => 00001100
 *   [9]  0x0A  dnp: round(586.0/58.6)=10
 *   [10-11] 0x00 0x00  LRP2 dlon (0)
 *   [12-13] 0x01 0xA3  LRP2 dlat (round(0.009*46603.377)=419=0x01A3)
 *   [14] 0x6C  LRP2 attr1 (same FRC/FOW/bearing)
 *   [15] 0x00  LRP2 attr2: bear_lo=0(000), pad=0(00000)
 *
 * Groups of 3 → base64:
 *   [80,0,0]    → UAAA
 *   [0,0,0]     → AAAA
 *   [0,108,12]  → AGwM
 *   [10,0,0]    → CgAA
 *   [1,163,108] → AaNs
 *   [0]         → AA==
 */
const CANONICAL: LineLocation = {
  lrps: [
    {
      lon: 0.0, lat: 0.0,
      frc: FRC.THIRD_CLASS, fow: FOW.SINGLE_CARRIAGEWAY,
      bearing: 0,
      lfrcnp: FRC.THIRD_CLASS, distanceToNext: 586.0,
    },
    {
      lon: 0.0, lat: 0.009,
      frc: FRC.THIRD_CLASS, fow: FOW.SINGLE_CARRIAGEWAY,
      bearing: 0,
    },
  ],
};

const CANONICAL_B64 = 'UAAAAAAAAGwMCgAAAaNsAA==';

describe('encodeLineLocation', () => {
  it('produces the expected base64 for the canonical example', () => {
    expect(encodeLineLocation(CANONICAL)).toBe(CANONICAL_B64);
  });

  it('rejects a location with fewer than 2 LRPs', () => {
    expect(() =>
      encodeLineLocation({
        lrps: [{ lon: 0, lat: 0, frc: 0, fow: 0, bearing: 0, distanceToNext: 100 }],
      })
    ).toThrow();
  });

  it('encodes a 3-LRP location without throwing', () => {
    const loc: LineLocation = {
      lrps: [
        { lon: -122.42, lat: 37.78, frc: FRC.SECOND_CLASS, fow: FOW.SINGLE_CARRIAGEWAY, bearing: 90, lfrcnp: FRC.SECOND_CLASS, distanceToNext: 500 },
        { lon: -122.415, lat: 37.78, frc: FRC.SECOND_CLASS, fow: FOW.SINGLE_CARRIAGEWAY, bearing: 90, lfrcnp: FRC.SECOND_CLASS, distanceToNext: 500 },
        { lon: -122.41, lat: 37.78, frc: FRC.SECOND_CLASS, fow: FOW.SINGLE_CARRIAGEWAY, bearing: 90 },
      ],
    };
    const b64 = encodeLineLocation(loc);
    expect(b64).toBeTypeOf('string');
    expect(b64.length).toBeGreaterThan(0);
  });

  it('encodes a location on the antimeridian (lon ≈ 180)', () => {
    const loc: LineLocation = {
      lrps: [
        { lon: 179.99, lat: 0.0, frc: FRC.OTHER, fow: FOW.OTHER, bearing: 0, lfrcnp: FRC.OTHER, distanceToNext: 1000 },
        { lon: 179.999, lat: 0.0, frc: FRC.OTHER, fow: FOW.OTHER, bearing: 90 },
      ],
    };
    const b64 = encodeLineLocation(loc);
    expect(b64).toBeTypeOf('string');
  });

  it('encodes a location at the equator crossing prime meridian', () => {
    const loc: LineLocation = {
      lrps: [
        { lon: -0.001, lat: 0.0, frc: FRC.OTHER, fow: FOW.OTHER, bearing: 90, lfrcnp: FRC.OTHER, distanceToNext: 200 },
        { lon: 0.001, lat: 0.0, frc: FRC.OTHER, fow: FOW.OTHER, bearing: 90 },
      ],
    };
    const b64 = encodeLineLocation(loc);
    expect(b64).toBeTypeOf('string');
  });
});
