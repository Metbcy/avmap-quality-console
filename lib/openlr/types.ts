/** Functional Road Class (OpenLR spec, Table 3.1) */
export const FRC = {
  MAIN_ROAD: 0,
  FIRST_CLASS: 1,
  SECOND_CLASS: 2,
  THIRD_CLASS: 3,
  FOURTH_CLASS: 4,
  FIFTH_CLASS: 5,
  SIXTH_CLASS: 6,
  OTHER: 7,
} as const;
export type FRCValue = (typeof FRC)[keyof typeof FRC];

/** Form of Way (OpenLR spec, Table 3.2) */
export const FOW = {
  UNDEFINED: 0,
  MOTORWAY: 1,
  MULTIPLE_CARRIAGEWAY: 2,
  SINGLE_CARRIAGEWAY: 3,
  ROUNDABOUT: 4,
  TRAFFIQUARE: 5,
  SLIP_ROAD: 6,
  OTHER: 7,
} as const;
export type FOWValue = (typeof FOW)[keyof typeof FOW];

export interface LocationReferencePoint {
  lon: number;       // degrees WGS84
  lat: number;       // degrees WGS84
  frc: FRCValue;
  fow: FOWValue;
  bearing: number;   // degrees, 0=north, clockwise, 0-359.99
  /** Lowest FRC on path to next LRP. Undefined for last LRP. */
  lfrcnp?: FRCValue;
  /** Distance in meters to next LRP. Undefined for last LRP. */
  distanceToNext?: number;
}

export interface LineLocation {
  /** At least 2 LRPs required (first + last, optional intermediates). */
  lrps: LocationReferencePoint[];
  /** Positive offset as fraction [0,1) of first segment length. Default 0. */
  pOffset?: number;
  /** Negative offset as fraction [0,1) of last segment length. Default 0. */
  nOffset?: number;
}
