import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Landmark } from '../data/types';

/**
 * Shared toolkit for hand-modelled landmarks.
 *
 * MODEL FRAME: metres, +y up, origin on the ground at the footprint centroid.
 * +x runs along the footprint's long axis. If the landmark has a front (towards its
 * main road), the front faces +z. The integrator places the group at
 * (lm.x, lm.ground, lm.z) and rotates it by -frame(lm).angle about +y.
 */
export type MatName =
  | 'white' | 'offwhite' | 'cream' | 'sand' | 'stone' | 'ochre' | 'red' | 'brick' | 'terracotta' | 'roofRed'
  | 'concrete' | 'darkConcrete' | 'asphalt' | 'glass' | 'darkGlass' | 'steel' | 'darkSteel' | 'membrane'
  | 'grass' | 'pitch' | 'track' | 'seatBlue' | 'seatYellow' | 'seatRed' | 'seatWhite' | 'seatGrey'
  | 'black' | 'gold' | 'green' | 'water' | 'stripeRed'
  // lit at night (emissive scaled by the night factor)
  | 'lamp' | 'windowLit' | 'floodlight' | 'clockFace' | 'sign' | 'aviationRed'
  // additive light beam (floodlight cones, lighthouse beam); opacity follows the night factor
  | 'beam';

const BASE: Record<string, number> = {
  white: 0xf2f0ea, offwhite: 0xe8e2d4, cream: 0xeadcb8, sand: 0xd9c49a, stone: 0xbdb5a6, ochre: 0xd4a35a,
  red: 0xb8483a, brick: 0xa4513d, terracotta: 0xc0643f, roofRed: 0x9c3f30, concrete: 0xc9c6bf,
  darkConcrete: 0x8c8983, asphalt: 0x4f5156, glass: 0x8fb3c4, darkGlass: 0x3d4f5c, steel: 0xb4b8bc,
  darkSteel: 0x5d6266, membrane: 0xf4f3ee, grass: 0x6fa34f, pitch: 0x7fb257, track: 0xb3563c,
  seatBlue: 0x2f62a8, seatYellow: 0xe0b52c, seatRed: 0xc23b30, seatWhite: 0xe9e9e4, seatGrey: 0x8f9396,
  black: 0x24262a, gold: 0xc9a043, green: 0x3f7a4a, water: 0x4f8fa6, stripeRed: 0xc0392b,
};
const GLOW: Record<string, [number, number]> = {
  lamp: [0xd9d4c4, 0xffc97a], windowLit: [0x5b6670, 0xffd79a], floodlight: [0xdfe3e6, 0xf4f7ff],
  clockFace: [0xf1ead6, 0xfff0c4], sign: [0xd8d3c6, 0xffe3a6], aviationRed: [0x8c2a24, 0xff3a28],
};

export interface LandmarkBuild {
  group: THREE.Group;
  /** called every frame: t seconds since start, night 0 (day) to 1 (full night) */
  animate?: (t: number, night: number) => void;
  notes?: string;
}
export type BuildFn = (lm: Landmark, kit: Kit) => LandmarkBuild;

export class Kit {
  readonly THREE = THREE;
  private mats = new Map<string, THREE.Material>();
  private glowing: { mat: THREE.MeshLambertMaterial; day: number }[] = [];
  private beams: THREE.MeshBasicMaterial[] = [];

  mat(name: MatName): THREE.Material {
    let m = this.mats.get(name);
    if (m) return m;
    if (name === 'beam') {
      const b = new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      this.beams.push(b);
      m = b;
    } else if (name in GLOW) {
      const [day, glow] = GLOW[name];
      const l = new THREE.MeshLambertMaterial({ color: day, emissive: glow, emissiveIntensity: 0 });
      this.glowing.push({ mat: l, day: name === 'aviationRed' ? 0.6 : 0 });
      m = l;
    } else {
      m = new THREE.MeshLambertMaterial({ color: BASE[name] ?? 0xff00ff });
    }
    this.mats.set(name, m);
    return m;
  }

  /** Merge geometries (same attribute layout) and dispose the inputs. */
  merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const prepared = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    for (const g of prepared) { g.deleteAttribute('uv'); if (!g.getAttribute('normal')) g.computeVertexNormals(); }
    const out = mergeGeometries(prepared, false);
    for (const g of geos) g.dispose();
    for (const g of prepared) g.dispose();
    if (!out) throw new Error('merge failed: attribute layouts differ');
    return out;
  }

  /** A mesh with shadows set the usual way (casts and receives). */
  mesh(geo: THREE.BufferGeometry, name: MatName, opts: { cast?: boolean; receive?: boolean } = {}): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.mat(name));
    m.castShadow = opts.cast ?? name !== 'beam';
    m.receiveShadow = opts.receive ?? name !== 'beam';
    m.name = name;
    return m;
  }

  /** The landmark's model frame: rotation angle so that +x is the long axis and +z the front. */
  frame(lm: Landmark): { angle: number; cos: number; sin: number } {
    let a = lm.angle ?? 0;
    if (lm.front && (lm.front[0] !== 0 || lm.front[1] !== 0)) {
      // local z of the front direction; flip the axis if the front would land on -z
      const lz = -lm.front[0] * Math.sin(a) + lm.front[1] * Math.cos(a);
      if (lz < 0) a += Math.PI;
    }
    return { angle: a, cos: Math.cos(a), sin: Math.sin(a) };
  }

  /** World (x, z) to the model frame. */
  toLocal(lm: Landmark, x: number, z: number): [number, number] {
    const { cos, sin } = this.frame(lm);
    const dx = x - lm.x, dz = z - lm.z;
    return [dx * cos + dz * sin, -dx * sin + dz * cos];
  }

  /** The OSM footprint ring in the model frame (empty for point or line landmarks). */
  ringLocal(lm: Landmark): [number, number][] {
    const r = lm.ring ?? [];
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < r.length; i += 2) out.push(this.toLocal(lm, r[i], r[i + 1]));
    return out;
  }

  /** A mapped polyline (world x, z pairs) in the model frame. */
  lineLocal(lm: Landmark, pts: number[]): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) out.push(this.toLocal(lm, pts[i], pts[i + 1]));
    return out;
  }

  /** Night factor 0..1: lights up every glowing material and fades the beams in. */
  setNight(n: number) {
    for (const { mat, day } of this.glowing) mat.emissiveIntensity = Math.max(day, n) * 1.6;
    for (const b of this.beams) b.opacity = 0.16 * n;
  }
}
