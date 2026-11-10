// Chennai Lighthouse (Marina Beach, opened 10 January 1977).
// A 45.72 m reinforced concrete tower of triangular section painted in red and white bands, with a
// viewing gallery on the 9th floor (enclosed by welded mesh), a radar room above it, a roof gallery
// and a small lantern. It is attached to a three-storey round harbour-control building and a
// single-storey museum wing (OSM building parts 1552618808 and 1552618807, modelled here because
// the landmark replaces the whole OSM outline 1552618806).
import * as THREE from 'three';
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild } from '../kit';
import { Parts, type V2, area, chamfer, faceAngle, flat, offsetConvex, outward, prism, ribbon, rng } from './_towers';

// Fallback triangle (model frame) if the OSM ring is missing: OSM way 211436935.
const TRI: V2[] = [[-5.19, -3.9], [6.87, -3.9], [0.86, 6.26]];
// Round harbour-control building (OSM part 1552618808, 15 m) and museum wing (1552618807, 5 m), model frame.
const ROUND = { x: -0.5, z: 7.92, r: 7.32, h: 15 };
const MUSEUM: V2[] = [[6.64, 9.49], [11.35, 9.21], [10.97, 5.93], [9.89, 2.83], [8.58, 0.58], [6.9, -1.4], [3.73, 1.92],
  [4.8, 2.84], [5.7, 3.98], [6.33, 5.24], [6.72, 6.64], [6.82, 7.91]];

/** The three corners of the largest triangle in the ring (the tower), ordered counter-clockwise. */
function towerTriangle(ring: V2[]): V2[] {
  if (ring.length < 3) return TRI;
  let best: V2[] = TRI, bestA = 0;
  for (let i = 0; i < ring.length; i++)
    for (let j = i + 1; j < ring.length; j++)
      for (let k = j + 1; k < ring.length; k++) {
        const t: V2[] = [ring[i], ring[j], ring[k]];
        const a = Math.abs(area(t));
        if (a > bestA) { bestA = a; best = t; }
      }
  return area(best) > 0 ? best : [best[0], best[2], best[1]];
}

/** Distance from p to the segment a-b and the position t along it. */
function segDist(p: V2, a: V2, b: V2): { d: number; t: number } {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return { d: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz), t };
}

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const group = new THREE.Group();
  group.name = 'lighthouse';
  const P = new Parts(kit);
  const rand = rng(1977);
  const H = Number(lm.height) || 45.72;

  const ring = kit.ringLocal(lm);
  const tri = towerTriangle(ring);
  const hex = chamfer(tri, 0.7);

  // the annex on one face (lift lobby joining the round building): ring points off the triangle
  let annex: V2[] | null = null;
  {
    let face = -1, lo = 1, hi = 0, depth = 0;
    for (const p of ring) {
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const n = outward(a, b, 1);
        const off = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
        const { t, d } = segDist(p, a, b);
        if (off > 1 && t > 0.05 && t < 0.95 && d < 4) {
          if (face < 0 || face === e) { face = e; lo = Math.min(lo, t); hi = Math.max(hi, t); depth = Math.max(depth, off); }
        }
      }
    }
    if (face >= 0 && hi - lo > 0.2) {
      const a = tri[face], b = tri[(face + 1) % 3];
      const n = outward(a, b, 1);
      const at = (t: number, d: number): V2 => [a[0] + (b[0] - a[0]) * t + n[0] * d, a[1] + (b[1] - a[1]) * t + n[1] * d];
      annex = [at(lo, -0.3), at(hi, -0.3), at(hi, depth), at(lo, depth)];
    }
  }

  // banded shaft: white base then red and white bands up to the 9th floor gallery
  const bandH = 4, shaftTop = 32;
  for (let i = 0; i * bandH < shaftTop; i++) {
    const y0 = i * bandH, y1 = Math.min(shaftTop, y0 + bandH);
    const mat = i % 2 === 0 ? 'white' : 'stripeRed';
    P.add(mat, prism(hex, y0, y1));
  }
  // the annex: a white link block between the tower and the round building
  if (annex) {
    P.add('white', prism(annex, 0, ROUND.h + 0.6));
    P.add('concrete', prism(offsetConvex(annex, -0.2), ROUND.h + 0.6, ROUND.h + 0.7));
  }

  // small windows: a column on each face, one per storey (stair lights)
  for (let e = 0; e < 3; e++) {
    const a = tri[e], b = tri[(e + 1) % 3];
    const n = outward(a, b, 1);
    const mx = (a[0] + b[0]) / 2 + n[0] * 0.04, mz = (a[1] + b[1]) / 2 + n[1] * 0.04;
    for (let k = 0; k < 9; k++) {
      const y = 2.2 + k * 3.5;
      // skip windows hidden by the round building, the museum wing or the annex
      if (Math.hypot(mx - ROUND.x, mz - ROUND.z) < ROUND.r + 0.5 && y < ROUND.h) continue;
      if (y < 5.5 && inside([mx + n[0] * 0.8, mz + n[1] * 0.8], MUSEUM)) continue;
      if (annex && y < ROUND.h + 1 && e === annexFace(tri, annex)) continue;
      P.quad(rand() < 0.5 ? 'windowLit' : 'darkGlass', mx, y, mz, 0.9, 1.5, faceAngle(n));
    }
  }

  // 9th floor viewing gallery: cantilevered deck, glazed wall and the welded-mesh cage
  const g0 = shaftTop, deck = offsetConvex(hex, 1.4);
  P.add('concrete', prism(deck, g0 - 0.45, g0));
  P.add('white', prism(offsetConvex(deck, 0.05), g0 - 0.9, g0 - 0.45));
  P.add('white', prism(hex, g0, g0 + 0.9));
  P.add('windowLit', prism(offsetConvex(hex, -0.25), g0 + 0.9, g0 + 2.6));
  P.add('white', prism(hex, g0 + 2.6, g0 + 3.4));
  const cage = offsetConvex(deck, -0.12);
  for (let i = 0; i < cage.length; i++) {
    const a = cage[i], b = cage[(i + 1) % cage.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / 0.75));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      P.box('steel', x - 0.04, g0, z - 0.04, x + 0.04, g0 + 2.9, z + 0.04);
    }
    P.beam('steel', a, b, g0 + 1.05, g0 + 1.13, 0.08);
    P.beam('steel', a, b, g0 + 2.85, g0 + 3.0, 0.1);
  }
  // mesh canopy above the cage
  P.add('white', prism(offsetConvex(deck, -0.05), g0 + 3.0, g0 + 3.4));

  // 10th floor (radar room) and roof gallery
  const r0 = g0 + 3.4, roof = r0 + 3.1;
  P.add('stripeRed', prism(hex, r0, roof));
  for (let e = 0; e < 3; e++) {
    const a = tri[e], b = tri[(e + 1) % 3];
    const n = outward(a, b, 1);
    for (const t of [0.3, 0.5, 0.7]) {
      const x = a[0] + (b[0] - a[0]) * t + n[0] * 0.04, z = a[1] + (b[1] - a[1]) * t + n[1] * 0.04;
      P.quad('darkGlass', x, r0 + 1.6, z, 1.1, 1.3, faceAngle(n));
    }
  }
  const roofDeck = offsetConvex(hex, 0.5);
  P.add('white', prism(roofDeck, roof, roof + 0.4));
  const rail = offsetConvex(roofDeck, -0.1);
  for (let i = 0; i < rail.length; i++) {
    const a = rail[i], b = rail[(i + 1) % rail.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / 1.5));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      P.box('steel', x - 0.04, roof + 0.4, z - 0.04, x + 0.04, roof + 1.45, z + 0.04);
    }
    P.beam('steel', a, b, roof + 1.38, roof + 1.48, 0.08);
  }

  // lantern on the roof, centred on the triangle's incentre-ish centroid
  const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cz = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
  // the real lantern house is 2.5 m across; drawn at 3 m so it still reads from the city view
  const LR = 1.5, ped0 = roof + 0.4, lan0 = ped0 + 1.3, lanH = 2.4, dome0 = lan0 + lanH + 0.25;
  const T = THREE;
  P.add('white', new T.CylinderGeometry(2.4, 2.6, 1.3, 20).translate(cx, ped0 + 0.65, cz));
  P.add('white', new T.CylinderGeometry(2.45, 2.45, 0.2, 20).translate(cx, lan0 - 0.1, cz));
  P.add('lamp', new T.CylinderGeometry(LR, LR, lanH, 16, 1, true).translate(cx, lan0 + lanH / 2, cz));
  P.add('lamp', new T.CylinderGeometry(0.55, 0.55, 1.2, 10).translate(cx, lan0 + lanH / 2, cz));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = cx + Math.cos(a) * (LR + 0.02), z = cz + Math.sin(a) * (LR + 0.02);
    P.box('darkSteel', x - 0.05, lan0, z - 0.05, x + 0.05, lan0 + lanH, z + 0.05);
  }
  P.add('darkSteel', new T.CylinderGeometry(LR + 0.08, LR + 0.08, 0.25, 16).translate(cx, lan0 + lanH + 0.12, cz));
  // lantern gallery rail
  P.add('steel', new T.CylinderGeometry(2.3, 2.3, 0.1, 20, 1, true).translate(cx, lan0 + 0.95, cz));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const x = cx + Math.cos(a) * 2.3, z = cz + Math.sin(a) * 2.3;
    P.box('steel', x - 0.035, lan0, z - 0.035, x + 0.035, lan0 + 1.0, z + 0.035);
  }
  // red dome, ventilator ball and lightning rod (top at H)
  const domeH = Math.max(1.0, Math.min(1.5, H - 0.9 - dome0));
  const prof: THREE.Vector2[] = [new T.Vector2(LR + 0.3, -0.12), new T.Vector2(LR + 0.3, 0)];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    prof.push(new T.Vector2(Math.max(0.001, (LR + 0.15) * Math.cos(a)), domeH * Math.sin(a)));
  }
  P.add('stripeRed', flat(new T.LatheGeometry(prof, 16).translate(cx, dome0, cz)));
  P.add('darkSteel', new T.SphereGeometry(0.28, 8, 6).translate(cx, dome0 + domeH + 0.18, cz));
  P.box('darkSteel', cx - 0.04, dome0 + domeH + 0.3, cz - 0.04, cx + 0.04, H, cz + 0.04);

  // round harbour-control building (3 storeys) and the museum wing
  const R = ROUND;
  P.add('white', new T.CylinderGeometry(R.r, R.r, R.h, 40).translate(R.x, R.h / 2, R.z));
  for (let s = 0; s < 3; s++) {
    const y0 = 1.6 + s * 4.9, y1 = y0 + 2.0;
    // window ribbon split into arcs so some rooms glow at night
    const n = 16;
    for (let k = 0; k < n; k++) {
      const t0 = (k / n) * Math.PI * 2 + 0.05, tl = (Math.PI * 2) / n - 0.1;
      P.add(rand() < 0.45 ? 'windowLit' : 'darkGlass', ribbon(R.x, R.z, R.r + 0.06, y0, y1, 3, t0, tl));
    }
  }
  P.add('white', new T.CylinderGeometry(R.r + 0.25, R.r + 0.25, 0.9, 40, 1, true).translate(R.x, R.h + 0.45, R.z));
  P.add('concrete', new T.CircleGeometry(R.r + 0.05, 40).rotateX(-Math.PI / 2).translate(R.x, R.h + 0.02, R.z));
  // museum wing
  P.add('offwhite', prism(MUSEUM, 0, 5));
  P.add('concrete', prism(MUSEUM, 5, 5.15));
  {
    const outer = MUSEUM.slice(1, 6);
    for (let i = 0; i + 1 < outer.length; i++) {
      const a = outer[i], b = outer[i + 1];
      const n = outward(a, b, Math.sign(area(MUSEUM)));
      const x = (a[0] + b[0]) / 2 + n[0] * 0.05, z = (a[1] + b[1]) / 2 + n[1] * 0.05;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      P.quad(i % 2 ? 'darkGlass' : 'windowLit', x, 2.6, z, len * 0.7, 1.8, faceAngle(n));
    }
  }
  // entrance door and canopy on the annex face that looks towards the road
  if (annex) {
    const a = annex[2], b = annex[3];
    const n = outward(a, b, Math.sign(area(annex)));
    const t = 1.4 / Math.hypot(b[0] - a[0], b[1] - a[1]);
    const x = a[0] + (b[0] - a[0]) * t + n[0] * 0.05, z = a[1] + (b[1] - a[1]) * t + n[1] * 0.05;
    P.quad('windowLit', x, 1.3, z, 1.6, 2.6, faceAngle(n));
    const c0: V2 = [x - n[1] * 1.2, z + n[0] * 1.2], c1: V2 = [x + n[1] * 1.2, z - n[0] * 1.2];
    const c2: V2 = [c1[0] + n[0] * 1.6, c1[1] + n[1] * 1.6], c3: V2 = [c0[0] + n[0] * 1.6, c0[1] + n[1] * 1.6];
    P.add('white', prism([c0, c1, c2, c3], 3.0, 3.3));
  }

  P.build(group);

  // rotating beam: two opposite beams of nested cones (bright core, long faint tail)
  const rotor = new T.Group();
  rotor.name = 'beamRotor';
  rotor.position.set(cx, lan0 + lanH / 2, cz);
  // closed spindles (no open cone rims): layers add up to a bright core that fades along the beam
  const cones: THREE.BufferGeometry[] = [];
  for (const dir of [0, Math.PI]) {
    for (const [len, rad] of [[150, 7], [122, 5.6], [95, 4.3], [70, 3.1], [46, 2.1], [24, 1.2]] as const) {
      const prof: THREE.Vector2[] = [];
      const steps = 9, a = 1, b = 0.3, peak = Math.pow(a / (a + b), a) * Math.pow(b / (a + b), b);
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        prof.push(new T.Vector2(Math.max(0.02, (rad * Math.pow(u, a) * Math.pow(1 - u, b)) / peak), u * len));
      }
      const g = new T.LatheGeometry(prof, 10);
      g.rotateZ(-Math.PI / 2);
      g.rotateY(dir);
      g.translate(dir === 0 ? 0.8 : -0.8, 0, 0);
      cones.push(g);
    }
  }
  const beamGeo = kit.merge(cones);
  beamGeo.computeBoundingSphere();
  // keep Box3.setFromObject framing the tower, not the 160 m beams (culling uses the true sphere)
  beamGeo.boundingBox = new T.Box3(new T.Vector3(-1.5, -1.5, -1.5), new T.Vector3(1.5, 1.5, 1.5));
  const beam = kit.mesh(beamGeo, 'beam');
  beam.renderOrder = 2;
  rotor.add(beam);
  rotor.visible = false;
  group.add(rotor);

  return {
    group,
    animate: (t, night) => {
      rotor.rotation.y = -(t / 10) * Math.PI * 2; // one turn every 10 s, clockwise seen from above
      rotor.visible = night > 0.02;
    },
    notes: 'Tower, round harbour-control building and museum wing from OSM (way 211436935, parts 1552618808 and 1552618807). '
      + 'Band count, dome colour, annex height and a slightly enlarged lantern are illustrated. Beam meshes keep a small '
      + 'bounding box so Box3 framing follows the tower; their bounding sphere is true for culling.',
  };
}

/** Point in polygon (even-odd rule). */
function inside(p: V2, poly: V2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Index of the triangle face that carries the annex. */
function annexFace(tri: V2[], annex: V2[]): number {
  const m: V2 = [(annex[0][0] + annex[1][0]) / 2, (annex[0][1] + annex[1][1]) / 2];
  let best = 0, bd = Infinity;
  for (let e = 0; e < 3; e++) {
    const d = segDist(m, tri[e], tri[(e + 1) % 3]).d;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
