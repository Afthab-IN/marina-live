import * as THREE from 'three';
import type { SceneData, Typed } from '../data/types';
import type { Grid } from './sampler';

export interface TrackPath { key: string; pts: Float32Array; s: Float32Array; length: number; stops: { name: string; s: number }[] }

/** Decode a train path: absolute x, y, z (y = terrain + illustrated deck height) and cumulative length. */
export function trackPaths(data: SceneData, a: Record<string, Typed>, ter: Grid): TrackPath[] {
  const q = data.meta.quant;
  return data.trains.map((t) => {
    const raw = a[`train_${t.key}_xyz`];
    const n = raw.length / 3;
    const pts = new Float32Array(n * 3), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = raw[3 * i] * q, yr = raw[3 * i + 1] * q, z = raw[3 * i + 2] * q;
      pts[3 * i] = x; pts[3 * i + 1] = ter.at(x, z) + yr + 0.25; pts[3 * i + 2] = z;
      if (i) s[i] = s[i - 1] + Math.hypot(x - pts[3 * i - 3], z - pts[3 * i - 1]);
    }
    return { key: t.key, pts, s, length: s[n - 1], stops: t.stops };
  });
}

/** Point and unit direction on a path at distance d. */
export function along(p: TrackPath, d: number, out: THREE.Vector3, dir?: THREE.Vector3) {
  const { s, pts } = p;
  const n = s.length;
  d = Math.min(Math.max(d, 0), p.length);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid] <= d) lo = mid; else hi = mid; }
  const t = (d - s[lo]) / Math.max(1e-6, s[hi] - s[lo]);
  out.set(pts[3 * lo] + (pts[3 * hi] - pts[3 * lo]) * t, pts[3 * lo + 1] + (pts[3 * hi + 1] - pts[3 * lo + 1]) * t,
    pts[3 * lo + 2] + (pts[3 * hi + 2] - pts[3 * lo + 2]) * t);
  if (dir) dir.set(pts[3 * hi] - pts[3 * lo], pts[3 * hi + 1] - pts[3 * lo + 1], pts[3 * hi + 2] - pts[3 * lo + 2]).normalize();
  return out;
}

class Strip {
  pos: number[] = []; col: number[] = []; idx: number[] = [];
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color) {
    const i = this.pos.length / 3;
    for (const v of [a, b, c, d]) { this.pos.push(v.x, v.y, v.z); this.col.push(color.r, color.g, color.b); }
    this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

const lin = (hex: number) => new THREE.Color(hex);

/** Rails on the ground, the elevated MRTS viaduct with piers, and illustrated station canopies. */
export function buildRail(data: SceneData, a: Record<string, Typed>, ter: Grid, paths: TrackPath[]) {
  const q = data.meta.quant;
  const group = new THREE.Group();
  group.name = 'rail';
  const steel = lin(0x3c3b3a), deckC = lin(0xbdb8ad), sideC = lin(0x9d988f), pierC = lin(0xb0aba0), roofC = lin(0xe6e3dc), platC = lin(0xc9c3b6);

  // MRTS deck vertices, used to keep ground rails from showing under the viaduct
  const elevated: [number, number][] = [];
  for (const p of paths) for (let i = 0; i < p.s.length; i++) if (p.pts[3 * i + 1] - ter.at(p.pts[3 * i], p.pts[3 * i + 2]) > 1.5) elevated.push([p.pts[3 * i], p.pts[3 * i + 2]]);
  const nearElevated = (x: number, z: number) => elevated.some(([ex, ez]) => (ex - x) ** 2 + (ez - z) ** 2 < 400);

  // ground rails as decals (two thin strips per track)
  const rails = new Strip();
  const st = a.rail_start, rxz = a.rail_xz, rat = a.rail_attr;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
  for (let l = 0; l < st.length - 1; l++) {
    const bridge = rat[2 * l] === 1;
    for (let v = st[l]; v < st[l + 1] - 1; v++) {
      const x0 = rxz[2 * v] * q, z0 = rxz[2 * v + 1] * q, x1 = rxz[2 * v + 2] * q, z1 = rxz[2 * v + 3] * q;
      if (bridge && nearElevated((x0 + x1) / 2, (z0 + z1) / 2)) continue;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.05) continue;
      const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
      for (const off of [-0.76, 0.76]) {
        const w = 0.09;
        const y0 = ter.at(x0, z0) + 0.13, y1 = ter.at(x1, z1) + 0.13;
        A.set(x0 + nx * (off - w), y0, z0 + nz * (off - w)); B.set(x1 + nx * (off - w), y1, z1 + nz * (off - w));
        C.set(x1 + nx * (off + w), y1, z1 + nz * (off + w)); D.set(x0 + nx * (off + w), y0, z0 + nz * (off + w));
        rails.quad(A, B, C, D, steel);
      }
    }
  }
  const railMesh = new THREE.Mesh(rails.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, depthTest: false, depthWrite: false }));
  railMesh.renderOrder = -6;
  railMesh.receiveShadow = true;
  group.add(railMesh);

  // viaduct: a deck along each elevated path, piers every ~30 m
  const deck = new Strip();
  const piers: THREE.Matrix4[] = [];
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), d0 = new THREE.Vector3();
  for (const p of paths) {
    let lastPier = -1e9;
    for (let i = 0; i < p.s.length - 1; i++) {
      const g0 = ter.at(p.pts[3 * i], p.pts[3 * i + 2]), g1 = ter.at(p.pts[3 * i + 3], p.pts[3 * i + 5]);
      const h0 = p.pts[3 * i + 1] - g0, h1 = p.pts[3 * i + 4] - g1;
      if (Math.max(h0, h1) < 1.0) continue;
      p0.set(p.pts[3 * i], p.pts[3 * i + 1] - 0.25, p.pts[3 * i + 2]);
      p1.set(p.pts[3 * i + 3], p.pts[3 * i + 4] - 0.25, p.pts[3 * i + 5]);
      d0.subVectors(p1, p0).setY(0).normalize();
      const nx = -d0.z, nz = d0.x, hw = 2.7, th = 1.3;
      const L = (o: number, y: number, P: THREE.Vector3) => new THREE.Vector3(P.x + nx * o, P.y + y, P.z + nz * o);
      deck.quad(L(-hw, 0, p0), L(-hw, 0, p1), L(hw, 0, p1), L(hw, 0, p0), deckC);           // top
      deck.quad(L(hw, 0, p0), L(hw, 0, p1), L(hw, -th, p1), L(hw, -th, p0), sideC);        // side
      deck.quad(L(-hw, -th, p0), L(-hw, -th, p1), L(-hw, 0, p1), L(-hw, 0, p0), sideC);    // other side
      for (const off of [-0.76, 0.76]) deck.quad(L(off - 0.09, 0.05, p0), L(off - 0.09, 0.05, p1), L(off + 0.09, 0.05, p1), L(off + 0.09, 0.05, p0), steel);
      // piers where the deck is high enough
      const segLen = p.s[i + 1] - p.s[i];
      for (let d = Math.ceil((p.s[i] + 1) / 30) * 30; d < p.s[i] + segLen; d += 30) {
        if (d - lastPier < 25) continue;
        const t = (d - p.s[i]) / segLen;
        const x = p0.x + (p1.x - p0.x) * t, z = p0.z + (p1.z - p0.z) * t, top = p0.y + (p1.y - p0.y) * t - th;
        const g = ter.at(x, z);
        if (top - g < 2) continue;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, g, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-d0.z, d0.x)),
          new THREE.Vector3(1, top - g, 1));
        piers.push(m);
        lastPier = d;
      }
    }
    // illustrated station canopies at elevated stops
    for (const stop of p.stops) {
      const c = along(p, stop.s, new THREE.Vector3(), new THREE.Vector3());
      const dir = along(p, stop.s + 1, new THREE.Vector3()).sub(c).setY(0).normalize();
      const nx = -dir.z, nz = dir.x;
      const half = 65, gnd = ter.at(c.x, c.z);
      const base = Math.max(c.y - 0.25, gnd + 0.2);
      const pa = c.clone().addScaledVector(dir, -half), pb = c.clone().addScaledVector(dir, half);
      const P = (P0: THREE.Vector3, o: number, y: number) => new THREE.Vector3(P0.x + nx * o, base + y, P0.z + nz * o);
      // side platform and a canopy roof over it
      deck.quad(P(pa, 2.8, 1.0), P(pb, 2.8, 1.0), P(pb, 6.5, 1.0), P(pa, 6.5, 1.0), platC);
      deck.quad(P(pa, 6.5, 1.0), P(pb, 6.5, 1.0), P(pb, 6.5, -0.4), P(pa, 6.5, -0.4), sideC);
      deck.quad(P(pa, 0.5, 6.4), P(pb, 0.5, 6.4), P(pb, 7.2, 6.0), P(pa, 7.2, 6.0), roofC);
      deck.quad(P(pa, 7.2, 6.0), P(pb, 7.2, 6.0), P(pb, 7.2, 5.6), P(pa, 7.2, 5.6), sideC);
    }
  }
  const deckMesh = new THREE.Mesh(deck.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  deckMesh.castShadow = deckMesh.receiveShadow = true;
  group.add(deckMesh);
  const pierGeo = new THREE.BoxGeometry(1.8, 1, 1.4).translate(0, 0.5, 0);
  const pierMesh = new THREE.InstancedMesh(pierGeo, new THREE.MeshLambertMaterial({ color: pierC }), Math.max(1, piers.length));
  piers.forEach((m, i) => pierMesh.setMatrixAt(i, m));
  pierMesh.count = piers.length;
  pierMesh.castShadow = pierMesh.receiveShadow = true;
  pierMesh.computeBoundingSphere();
  group.add(pierMesh);
  return { group, piers: piers.length };
}
