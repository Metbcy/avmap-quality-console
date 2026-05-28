import { describe, expect, it } from 'vitest';
import { encodeLineLocation, haversineMeters } from '../../lib/openlr/encode';
import { decodeLineLocation } from '../../lib/openlr/decode';
import { FRC, FOW } from '../../lib/openlr/types';
import type { FRCValue, FOWValue, LineLocation } from '../../lib/openlr/types';

const TOLERANCE_M = 5;

/** Build a minimal 2-LRP LineLocation. */
function make2Lrp(
  lon1: number, lat1: number,
  lon2: number, lat2: number,
  frc: FRCValue = FRC.THIRD_CLASS,
  fow: FOWValue = FOW.SINGLE_CARRIAGEWAY,
): LineLocation {
  const dist = haversineMeters(lon1, lat1, lon2, lat2);
  return {
    lrps: [
      { lon: lon1, lat: lat1, frc, fow, bearing: 0, lfrcnp: frc, distanceToNext: dist },
      { lon: lon2, lat: lat2, frc, fow, bearing: 180 },
    ],
  };
}

function roundTripOk(loc: LineLocation): boolean {
  const b64 = encodeLineLocation(loc);
  const decoded = decodeLineLocation(b64);
  if (decoded.lrps.length !== loc.lrps.length) return false;
  for (let i = 0; i < loc.lrps.length; i++) {
    const orig = loc.lrps[i];
    const rt = decoded.lrps[i];
    const dist = haversineMeters(orig.lon, orig.lat, rt.lon, rt.lat);
    if (dist > TOLERANCE_M) return false;
  }
  return true;
}

describe('round-trip: encode then decode within 5m', () => {
  // 10 diverse locations
  const cases: Array<[string, LineLocation]> = [
    ['SF Market St',      make2Lrp(-122.4194, 37.7749, -122.4180, 37.7755)],
    ['NYC Broadway',      make2Lrp(-73.9857, 40.7580, -73.9840, 40.7600)],
    ['Tokyo Ring',        make2Lrp(139.6917, 35.6895, 139.6950, 35.6910)],
    ['London City',       make2Lrp(-0.1276, 51.5074, -0.1260, 51.5080)],
    ['Equator/meridian',  make2Lrp(0.0, 0.0, 0.001, 0.0)],
    ['Near antimeridian', make2Lrp(179.99, -10.0, 179.999, -10.001)],
    ['High latitude',     make2Lrp(10.0, 70.0, 10.01, 70.001)],
    ['South hemisphere',  make2Lrp(-43.17, -22.91, -43.16, -22.90)],
    ['Motorway FRC0',     make2Lrp(2.3, 48.85, 2.31, 48.855, FRC.MAIN_ROAD, FOW.MOTORWAY)],
    ['3-LRP path', {
      lrps: [
        { lon: 0.0, lat: 0.0, frc: FRC.THIRD_CLASS, fow: FOW.SINGLE_CARRIAGEWAY, bearing: 0, lfrcnp: FRC.THIRD_CLASS, distanceToNext: 600 },
        { lon: 0.0, lat: 0.005, frc: FRC.THIRD_CLASS, fow: FOW.SINGLE_CARRIAGEWAY, bearing: 45, lfrcnp: FRC.THIRD_CLASS, distanceToNext: 800 },
        { lon: 0.005, lat: 0.01, frc: FRC.THIRD_CLASS, fow: FOW.SINGLE_CARRIAGEWAY, bearing: 90 },
      ],
    }],
  ];

  for (const [name, loc] of cases) {
    it(name, () => {
      expect(roundTripOk(loc)).toBe(true);
    });
  }

  it('single-segment (2 LRPs) round-trips correctly', () => {
    const loc = make2Lrp(-122.4, 37.78, -122.39, 37.78);
    expect(roundTripOk(loc)).toBe(true);
  });

  it('multi-segment (5 LRPs) round-trips correctly', () => {
    const loc: LineLocation = {
      lrps: Array.from({ length: 5 }, (_, i) => ({
        lon: i * 0.003,
        lat: i * 0.003,
        frc: FRC.THIRD_CLASS,
        fow: FOW.SINGLE_CARRIAGEWAY,
        bearing: 45,
        ...(i < 4 ? { lfrcnp: FRC.THIRD_CLASS, distanceToNext: 500 } : {}),
      })),
    };
    expect(roundTripOk(loc)).toBe(true);
  });
});
