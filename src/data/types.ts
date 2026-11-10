export type ArrayType = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32';
export interface ArrayInfo { type: ArrayType; offset: number; length: number }
export type Typed = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array;

export interface GridInfo { x0: number; z0: number; step: number; cols: number; rows: number; scale?: number }

export interface Landmark {
  key: string; title: string; name: string; name_ta: string; osm: string;
  model: boolean; camera: boolean; x: number; z: number; ground: number;
  angle?: number; length?: number; width?: number; area?: number; ring?: number[]; line?: number[];
  height?: string; building_levels?: string; span?: number; replaces?: number;
}

export interface Stop { name: string; name_ta: string; s: number }
export interface Train { key: string; name: string; length: number; stops: Stop[] }

export interface LabelPoint { n: string; ta: string; x: number; z: number; a?: number; k?: string; len?: number; sea?: boolean }

export interface SceneMeta {
  title: string;
  bbox: { south: number; west: number; north: number; east: number };
  origin: [number, number];
  frame_m: [number, number, number, number];
  quant: number;
  chunk: number;
  chunks: [number, number];
  counts: {
    buildings: number; buildings_by_footprint: Record<string, number>; heights: Record<string, number>;
    trees_mapped: number; trees_illustrated: number; lamps_mapped: number; lamps_illustrated: number;
    road_km: number; rail_km: number; traffic_paths: number; landmarks: number;
  };
  cover_classes: string[]; road_classes: string[]; building_classes: string[];
  height_sources: string[]; footprint_sources: string[]; tree_kinds: string[]; traffic_names: string[];
  sources: string[]; mapped: string; illustrated: string;
  terrain: GridInfo; coast: GridInfo & { scale: number };
}

export interface SceneData {
  version: number; built: string; meta: SceneMeta; landmarks: Landmark[]; trains: Train[];
  labels: { places: LabelPoint[]; stations: LabelPoint[]; roads: LabelPoint[]; parks: LabelPoint[]; water: LabelPoint[] };
  packs: { world: { file: string; bytes: number; raw: number; arrays: Record<string, ArrayInfo> } };
}
