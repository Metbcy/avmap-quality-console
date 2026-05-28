export type DiffKind = 'new_lane' | 'moved_crosswalk' | 'removed_stop_sign';
export type DiffStatus = 'pending' | 'approved' | 'rejected';

export interface MapDiff {
  id: string;
  kind: DiffKind;
  description: string;
  geometryV1?: number[] | number[][];
  geometryV2?: number[] | number[][];
}

export const DIFFS: MapDiff[] = [
  {
    id: 'D-001',
    kind: 'new_lane',
    description: 'New left-turn lane added on Castro St near W El Camino Real',
    geometryV2: [
      [-122.0831, 37.3932],
      [-122.0835, 37.3940],
    ],
  },
  {
    id: 'D-002',
    kind: 'moved_crosswalk',
    description: 'Relocated crosswalk on Shoreline Blvd at Latham St intersection',
    geometryV1: [
      [-122.0945, 37.3963],
      [-122.0948, 37.3965],
    ],
    geometryV2: [
      [-122.0944, 37.3962],
      [-122.0947, 37.3964],
    ],
  },
  {
    id: 'D-003',
    kind: 'removed_stop_sign',
    description: 'Stop sign removed at Cuesta Dr and Montclaire Way',
    geometryV1: [-122.0785, 37.3735],
  },
  {
    id: 'D-004',
    kind: 'new_lane',
    description: 'Added bike lane segment on Middlefield Rd near San Antonio Rd',
    geometryV2: [
      [-122.1082, 37.4115],
      [-122.1095, 37.4125],
    ],
  },
  {
    id: 'D-005',
    kind: 'moved_crosswalk',
    description: 'Updated crosswalk alignment at Rengstorff Ave and Central Expressway',
    geometryV1: [
      [-122.0995, 37.4082],
      [-122.1002, 37.4085],
    ],
    geometryV2: [
      [-122.0994, 37.4081],
      [-122.1001, 37.4084],
    ],
  },
];
