import { describe, expect, it } from 'vitest';
import { decodeLineLocation } from '../../lib/openlr/decode';
import { FRC, FOW } from '../../lib/openlr/types';

const CANONICAL_B64 = 'UAAAAAAAAGwMCgAAAaNsAA==';

describe('decodeLineLocation', () => {
  it('decodes canonical example to expected LRP count and approximate coordinates', () => {
    const loc = decodeLineLocation(CANONICAL_B64);
    expect(loc.lrps).toHaveLength(2);

    const lrp1 = loc.lrps[0];
    expect(lrp1.lon).toBeCloseTo(0.0, 3);
    expect(lrp1.lat).toBeCloseTo(0.0, 3);
    expect(lrp1.frc).toBe(FRC.THIRD_CLASS);
    expect(lrp1.fow).toBe(FOW.SINGLE_CARRIAGEWAY);
    // bearing sector 0 → midpoint = 360/32/2 = 5.625 degrees
    expect(lrp1.bearing).toBeCloseTo(5.625, 3);
    expect(lrp1.lfrcnp).toBe(FRC.THIRD_CLASS);
    // dist = 10 * 58.6 = 586.0
    expect(lrp1.distanceToNext).toBeCloseTo(586.0, 1);

    const lrp2 = loc.lrps[1];
    expect(lrp2.lon).toBeCloseTo(0.0, 3);
    expect(lrp2.lat).toBeCloseTo(0.009, 3);
    expect(lrp2.frc).toBe(FRC.THIRD_CLASS);
    expect(lrp2.fow).toBe(FOW.SINGLE_CARRIAGEWAY);
    expect(lrp2.distanceToNext).toBeUndefined();
  });

  it('rejects data with wrong version byte', () => {
    // Change version bits (upper 3 bits) to 1 (=001xxxxx)
    const bad = btoa('\x20' + '\x00'.repeat(15));
    expect(() => decodeLineLocation(bad)).toThrow('Unsupported OpenLR version');
  });

  it('rejects a buffer that is too short', () => {
    const tooShort = btoa('\x50\x00\x00\x00\x00\x00\x00\x68');
    expect(() => decodeLineLocation(tooShort)).toThrow();
  });
});
