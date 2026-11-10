// Shared helpers for the two stadium models (chepauk_stadium, nehru_stadium):
// a flat-shaded triangle soup per material, a profile sweep for stand bowls,
// tensile cone roofs, and floodlight towers with night beams.
import * as THREE from 'three';
import type { Kit, MatName } from '../kit';

export type V3 = [number, number, number];
/** A profile point: d = metres out from the stand's inner edge, y = height. */
export type P2 = [number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Triangle soup grouped by material. Every face gets its own normal (crisp maquette look). */
export class Soup {
  private bufs = new Map<MatName, number[]>();
  private arr(m: MatName): number[] {
    let a = this.bufs.get(m);
    if (!a) { a = []; this.bufs.set(m, a); }
    return a;
  }
  tri(m: MatName, a: V3, b: V3, c: V3) {
    this.arr(m).push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
  /** Quad a-b-c-d (in order around it), turned so its face looks along `hint`. Degenerate quads are skipped. */
  quad(m: MatName, a: V3, b: V3, c: V3, d: V3, hint: V3, twoSided = false) {
    const n1 = cross(sub(b, a), sub(c, a)), n2 = cross(sub(c, a), sub(d, a));
    const area = Math.hypot(...n1) + Math.hypot(...n2);
    if (area < 1e-6) return;
    const flip = dot([n1[0] + n2[0], n1[1] + n2[1], n1[2] + n2[2]], hint) < 0;
    if (flip) { this.tri(m, a, d, c); this.tri(m, a, c, b); } else { this.tri(m, a, b, c); this.tri(m, a, c, d); }
    if (twoSided) {
      if (flip) { this.tri(m, a, b, c); this.tri(m, a, c, d); } else { this.tri(m, a, d, c); this.tri(m, a, c, b); }
    }
  }
  triFacing(m: MatName, a: V3, b: V3, c: V3, hint: V3, twoSided = false) {
    const n = cross(sub(b, a), sub(c, a));
    if (Math.hypot(...n) < 1e-6) return;
    if (dot(n, hint) < 0) this.tri(m, a, c, b); else this.tri(m, a, b, c);
    if (twoSided) { if (dot(n, hint) < 0) this.tri(m, a, b, c); else this.tri(m, a, c, b); }
  }
  /** Append a three.js primitive (its own winding is kept), optionally transformed. */
  add(m: MatName, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const p = g.getAttribute('position');
    const a = this.arr(m);
    for (let i = 0; i < p.count; i++) a.push(p.getX(i), p.getY(i), p.getZ(i));
    g.dispose();
  }
  /** An axis-aligned-in-its-own-frame box from a to b (centre line), w wide, h tall. */
  beam(m: MatName, a: V3, b: V3, w: number, h: number) {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    if (len < 1e-4) return;
    const g = new THREE.BoxGeometry(w, h, len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    const mtx = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
    this.add(m, g, mtx);
    g.dispose();
  }
  /** Axis-aligned box by centre and size, optionally turned by `rot` radians about +y. */
  box(m: MatName, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rot = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (rot) g.rotateY(rot);
    g.translate(cx, cy, cz);
    this.add(m, g);
    g.dispose();
  }
  /** Vertical post (n-sided prism) from y0 to y1. */
  post(m: MatName, x: number, z: number, y0: number, y1: number, r0: number, r1 = r0, sides = 6) {
    if (y1 - y0 < 1e-3) return;
    const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 1, false).translate(x, (y0 + y1) / 2, z);
    this.add(m, g);
    g.dispose();
  }
  triangles() {
    let n = 0;
    for (const a of this.bufs.values()) n += a.length / 9;
    return n;
  }
  /** One mesh per material, added to the group. */
  build(kit: Kit, group: THREE.Group, opts: { cast?: boolean; receive?: boolean } = {}) {
    for (const [m, a] of this.bufs) {
      if (!a.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      group.add(kit.mesh(g, m, opts));
    }
  }
}

/** Distance from (ox, oz) along the unit direction (dx, dz) to the first crossing of the ring. */
export function rayToRing(ring: [number, number][], ox: number, oz: number, dx: number, dz: number): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const ex = bx - ax, ez = bz - az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - ox) * ez - (az - oz) * ex) / den;
    const u = ((ax - ox) * dz - (az - oz) * dx) / den;
    if (t > 0.01 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
  }
  return best;
}

/** A point on a stand's inner edge with its outward unit normal and the depth to the outer outline. */
export interface Station { x: number; z: number; nx: number; nz: number; depth: number }

const at = (s: Station, p: P2): V3 => [s.x + s.nx * p[0], p[1], s.z + s.nz * p[0]];

/**
 * Sweep per-station profiles (same point count at every station) along a run of stations.
 * Profiles run clockwise in (d, y): up the front, over the top and down the back, so each face is
 * turned out of the solid. mat(i, k) picks the material of segment k between stations i and i + 1
 * (null skips it). `loop` joins the last station to the first; `caps` closes open ends.
 */
export function sweep(soup: Soup, st: Station[], prof: P2[][], mat: (i: number, k: number) => MatName | null,
  opts: { loop?: boolean; caps?: MatName; closed?: boolean } = {}) {
  const n = st.length;
  const last = opts.loop ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const s0 = st[i], s1 = st[j], p0 = prof[i], p1 = prof[j];
    const nx = (s0.nx + s1.nx) / 2, nz = (s0.nz + s1.nz) / 2;
    const segs = opts.closed ? p0.length : p0.length - 1;
    for (let k = 0; k < segs; k++) {
      const m = mat(i, k);
      if (!m) continue;
      const k2 = (k + 1) % p0.length;
      const dd = (p0[k2][0] - p0[k][0] + p1[k2][0] - p1[k][0]) / 2;
      const dy = (p0[k2][1] - p0[k][1] + p1[k2][1] - p1[k][1]) / 2;
      // outward normal of a clockwise profile is the left normal (-dy, dd) in (d, y)
      const hint: V3 = [-dy * nx, dd, -dy * nz];
      soup.quad(m, at(s0, p0[k]), at(s0, p0[k2]), at(s1, p1[k2]), at(s1, p1[k]), hint);
    }
  }
  if (opts.caps && !opts.loop && n > 1) {
    for (const [i, sign] of [[0, -1], [n - 1, 1]] as [number, number][]) {
      // the cap looks away from the run: from the neighbouring station towards this end
      const s = st[i], o = st[sign > 0 ? n - 2 : 1];
      const tl = Math.hypot(s.x - o.x, s.z - o.z) || 1;
      const hint: V3 = [(s.x - o.x) / tl, 0, (s.z - o.z) / tl];
      const pts = prof[i];
      const contour = pts.map(([d, y]) => new THREE.Vector2(d, y));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const [a, b, c] of tris) soup.triFacing(opts.caps, at(s, pts[a]), at(s, pts[b]), at(s, pts[c]), hint);
    }
  }
}

/** Stepped rake from (d0, y0) to (d1, y1): riser then tread, `steps` times. */
export function rake(d0: number, y0: number, d1: number, y1: number, steps: number): P2[] {
  const out: P2[] = [];
  const dd = (d1 - d0) / steps, dy = (y1 - y0) / steps;
  for (let s = 0; s < steps; s++) {
    out.push([d0 + s * dd, y0 + (s + 1) * dy]);
    out.push([d0 + (s + 1) * dd, y0 + (s + 1) * dy]);
  }
  return out;
}

/**
 * A conical tensile membrane: perimeter points (any closed loop, roughly planar) pulled up to an apex.
 * Two-sided so it reads from above and below. The radial profile is log-shaped like a real cone tent.
 */
export function coneMembrane(soup: Soup, m: MatName, perim: V3[], apex: V3, topFrac = 0.93) {
  const rings = [0, 0.3, 0.55, 0.75, 0.88, topFrac];
  const norm = Math.log(1 / (1 - topFrac));
  const pt = (p: V3, s: number): V3 => {
    const h = Math.log(1 / (1 - s)) / norm;
    return [lerp(p[0], apex[0], s), p[1] + (apex[1] - p[1]) * h, lerp(p[2], apex[2], s)];
  };
  const n = perim.length;
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let j = 0; j < n; j++) {
      const a = perim[j], b = perim[(j + 1) % n];
      soup.quad(m, pt(a, rings[r]), pt(b, rings[r]), pt(b, rings[r + 1]), pt(a, rings[r + 1]), [0, 1, 0], true);
    }
  }
  // close the top ring with a small cap at the apex
  const top = perim.map((p) => pt(p, topFrac));
  for (let j = 0; j < n; j++) soup.triFacing(m, top[j], top[(j + 1) % n], apex, [0, 1, 0], true);
}

export interface TowerSpec {
  /** foot of the mast */
  x: number; z: number; y0: number;
  /** height of the head centre */
  h: number;
  /** point the lamps aim at */
  aim: V3;
  headW: number; headH: number; rows: number; cols: number;
  rBase: number; rTop: number;
  /** beam radius where it reaches the aim point */
  beamR: number;
  /** head leans this far towards the aim (horizontal metres) */
  reach?: number;
  pole: MatName; frame: MatName;
}

/** A floodlight mast: tapered pole, tilted lamp head ('floodlight' panels), red aviation lamp, and a beam cone. */
export function floodlightTower(soup: Soup, beams: Soup, t: TowerSpec) {
  const ax = t.aim[0] - t.x, az = t.aim[2] - t.z;
  const al = Math.hypot(ax, az) || 1;
  const reach = t.reach ?? 1.2;
  const hx = t.x + (ax / al) * reach, hz = t.z + (az / al) * reach;
  const head = new THREE.Vector3(hx, t.h, hz);
  // pole up to just under the head
  soup.post(t.pole, t.x, t.z, t.y0, t.h - t.headH * 0.35, t.rBase, t.rTop, 8);
  // short bracket from the pole top to the back of the head
  soup.beam(t.pole, [t.x, t.h - t.headH * 0.35, t.z], [hx, t.h - t.headH * 0.1, hz], t.rTop * 1.4, t.rTop * 1.4);
  const aimV = new THREE.Vector3(...t.aim);
  const fwd = aimV.clone().sub(head).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(fwd).normalize();
  const up = fwd.clone().cross(right).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, fwd).setPosition(head);
  const frame = new THREE.BoxGeometry(t.headW, t.headH, 0.8);
  soup.add(t.frame, frame, basis);
  frame.dispose();
  const cw = t.headW / t.cols, ch = t.headH / t.rows;
  const lamp = new THREE.BoxGeometry(cw * 0.78, ch * 0.72, 0.5);
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      const m = new THREE.Matrix4().makeTranslation(-t.headW / 2 + (c + 0.5) * cw, -t.headH / 2 + (r + 0.5) * ch, 0.55);
      soup.add('floodlight', lamp, basis.clone().multiply(m));
    }
  }
  lamp.dispose();
  // aviation lamp on top of the head
  const topC = head.clone().addScaledVector(up, t.headH / 2 + 0.5);
  const av = new THREE.BoxGeometry(0.9, 0.9, 0.9).translate(topC.x, topC.y, topC.z);
  soup.add('aviationRed', av);
  av.dispose();
  // beam: an oblique cone from the lamp face to a circle lying on the ground round the aim point
  const apex: V3 = [head.x + fwd.x * 0.9, head.y + fwd.y * 0.9, head.z + fwd.z * 0.9];
  const segs = 20;
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
    beams.tri('beam', apex, [t.aim[0] + t.beamR * Math.cos(a1), t.aim[1], t.aim[2] + t.beamR * Math.sin(a1)],
      [t.aim[0] + t.beamR * Math.cos(a0), t.aim[1], t.aim[2] + t.beamR * Math.sin(a0)]);
  }
}
