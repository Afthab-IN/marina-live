// Ripon Building (Greater Chennai Corporation; foundation stone 1909, completed 1913, architect G. S. T. Harris).
// An all-white neoclassical block of three storeys around two courtyards, about 85 x 32 m in the brief and
// mapped by OSM (relation 60184) with both courtyards. Round-arched openings in a regular bay rhythm,
// Madras terrace roofs behind a balustrade, and the 43 m central clock tower with a 2.5 m clock on each face.
//
// The tower and the carriage porch stand on the side of the footprint that carries the porch projection
// (local -z, towards General Hospital Road): Google 2.5D heights put the tall cell there too.
import * as THREE from 'three';
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild } from '../kit';
import { Parts, archShape, rng, type V2 } from './_towers';
import {
  type Plan, band, clean, clock, dome, edgesOf, finish, gridAngle, openings, parapet, pilasters, planEdges, rect,
  roof, rotPts, shaft, triStats, walls,
} from './_heritage';

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const group = new THREE.Group();
  group.name = 'ripon_building';
  const P = new Parts(kit);
  const rand = rng(1913);

  let ring = clean(kit.ringLocal(lm));
  const holes0 = (lm.holes ?? []).map((h) => clean(kit.lineLocal(lm, h)));
  if (ring.length < 3) ring = rect(-42, -16, 42, 16);
  const th = gridAngle([ring]);
  let outer = rotPts(ring, th);
  const holes = holes0.filter((h) => h.length >= 3).map((h) => rotPts(h, th));

  // the carriage porch: the deepest projection of the ring (about 7.7 m beyond the facade)
  const zs = outer.map((p) => p[1]);
  const zMin = Math.min(...zs), zMax = Math.max(...zs);
  const side = -zMin >= zMax ? -1 : 1;          // facade side of the porch and the tower
  const deep = side < 0 ? zMin : zMax;
  const porchPts = outer.filter((p) => Math.abs(p[1] - deep) < 0.6);
  let face = deep - side * 7.7;                  // facade line behind the porch
  let porch: { x0: number; x1: number } | null = null;
  if (porchPts.length >= 2) {
    const xs = porchPts.map((p) => p[0]);
    porch = { x0: Math.min(...xs), x1: Math.max(...xs) };
    // nearest facade line next to the porch
    const others = outer.filter((p) => Math.abs(p[1] - deep) > 3 && Math.abs(p[0] - (porch!.x0 + porch!.x1) / 2) < 12);
    if (others.length) face = others.reduce((a, p) => (Math.abs(p[1] - deep) < Math.abs(a - deep) ? p[1] : a), others[0][1]);
    outer = outer.map((p) => (Math.abs(p[1] - deep) < 0.6 ? [p[0], face] as V2 : p));
    outer = clean(outer, 0.5);
  }
  const plan: Plan = { outer, holes };

  const H = 15.6, F1 = 5.4, F2 = 10.4;

  // body
  walls(P, 'white', plan, 0, H);
  band(P, 'stone', plan, 0, 0.75, 0.25);
  band(P, 'offwhite', plan, F1 - 0.2, F1 + 0.25, 0.22);
  band(P, 'offwhite', plan, F2 - 0.2, F2 + 0.25, 0.22);
  band(P, 'offwhite', plan, H - 0.7, H, 0.45);
  parapet(P, 'offwhite', 'white', plan, H, 1.0, 0.3);
  roof(P, 'terracotta', plan, H + 0.05, 0.25);

  // three storeys of round-arched openings with pilasters between the bays
  const es = planEdges(plan);
  // Google 2.5D puts the tall cells about 10 m behind the porch facade, over the range between the courtyards
  const tower = { x: porch ? (porch.x0 + porch.x1) / 2 : 0, z: face - side * 10.0, a: 5.0 };
  const behindTower = (p: V2) => Math.abs(p[0] - tower.x) < tower.a + 0.6 && Math.abs(p[1] - tower.z) < tower.a + 1.2;
  const behindPorch = (p: V2) => !!porch && p[0] > porch.x0 - 0.5 && p[0] < porch.x1 + 0.5 && Math.abs(p[1] - face) < 1.5;
  openings(P, rand, es, { y: 1.1, h: 3.5, w: 1.9, bay: 3.7, point: 1, seg: 3, lit: 0.3, skip: (p) => behindTower(p) || behindPorch(p) });
  openings(P, rand, es, { y: F1 + 0.8, h: 3.4, w: 1.9, bay: 3.7, point: 1, seg: 3, lit: 0.35, skip: behindTower });
  openings(P, rand, es, { y: F2 + 0.8, h: 3.1, w: 1.7, bay: 3.7, point: 1, seg: 3, lit: 0.3, skip: behindTower });
  pilasters(P, 'offwhite', edgesOf(plan.outer), { y0: 0.75, y1: H - 0.7, w: 0.55, bay: 3.7, minLen: 6, skip: (p) => behindTower(p) || behindPorch(p) });

  // corner pavilions and the end bays rise a little above the balustrade
  for (const sx of [-1, 1]) {
    const xs = outer.map((p) => p[0] * sx);
    const xe = Math.max(...xs) * sx;
    // the end pavilion on each short side
    const endPts = outer.filter((p) => Math.abs(p[0] - xe) < 1.2);
    if (endPts.length >= 2) {
      const za = Math.min(...endPts.map((p) => p[1])), zb = Math.max(...endPts.map((p) => p[1]));
      const x0 = sx > 0 ? xe - 6.5 : xe, x1 = sx > 0 ? xe : xe + 6.5;
      const pav: Plan = { outer: rect(x0, za, x1, zb), holes: [] };
      walls(P, 'white', pav, H, H + 2.4);
      band(P, 'offwhite', pav, H + 1.9, H + 2.4, 0.3);
      roof(P, 'terracotta', pav, H + 2.4);
      // pediment on the outer face
      const pd = new THREE.Shape();
      const w = (zb - za) * 0.42;
      pd.moveTo(-w, 0); pd.lineTo(w, 0); pd.lineTo(0, 2.0); pd.closePath();
      P.shape('offwhite', pd, xe + sx * 0.08, H + 2.4, (za + zb) / 2, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
      for (const o of [-1, 1]) {
        P.shape('darkGlass', archShape(1.2, 1.5, 1, 3), xe + sx * 0.06, H + 0.25, (za + zb) / 2 + o * 2.4, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
  }

  // carriage porch: columns, three arches on the front, a balustraded terrace
  if (porch) {
    const { x0, x1 } = porch;
    const z0 = Math.min(face, deep), z1 = Math.max(face, deep), ph = 6.2;
    P.box('white', x0, ph - 1.1, z0, x1, ph, z1);
    P.box('offwhite', x0 - 0.2, ph - 0.25, z0 - 0.2, x1 + 0.2, ph + 0.05, z1 + 0.2);
    P.box('terracotta', x0 + 0.3, ph + 0.05, z0 + 0.3, x1 - 0.3, ph + 0.1, z1 - 0.3);
    const pp: Plan = { outer: rect(x0, z0, x1, z1), holes: [] };
    parapet(P, 'offwhite', 'white', pp, ph + 0.05, 0.9, 0.25);
    const zf = deep, cw = 0.7;
    for (let i = 0; i <= 3; i++) {
      const x = x0 + 0.35 + (i * (x1 - x0 - 0.7)) / 3;
      for (const z of [zf - side * 0.35, face + side * 0.6]) P.box('offwhite', x - cw / 2, 0, z - cw / 2, x + cw / 2, ph - 1.1, z + cw / 2);
    }
    P.box('stone', x0 - 0.3, 0, z0 - 0.3, x1 + 0.3, 0.35, z1 + 0.3);
    // dark entrance hall behind the porch
    P.quad('windowLit', (x0 + x1) / 2, 2.6, face + side * 0.07, x1 - x0 - 3, 4.4, side > 0 ? 0 : Math.PI);
  }

  // frontispiece over the porch: a raised attic with a pediment on the facade
  if (porch) {
    const x0 = porch.x0 - 1.2, x1 = porch.x1 + 1.2, za = Math.min(face, face - side * 4.5), zb = Math.max(face, face - side * 4.5);
    const fp: Plan = { outer: rect(x0, za, x1, zb), holes: [] };
    walls(P, 'white', fp, H, H + 2.6);
    band(P, 'offwhite', fp, H + 2.1, H + 2.6, 0.3);
    roof(P, 'terracotta', fp, H + 2.6);
    const pd = new THREE.Shape();
    const w = (x1 - x0) * 0.5 + 0.2;
    pd.moveTo(-w, 0); pd.lineTo(w, 0); pd.lineTo(0, 2.6); pd.closePath();
    P.shape('offwhite', pd, (x0 + x1) / 2, H + 2.6, face + side * 0.1, side > 0 ? 0 : Math.PI);
    for (const o of [-3.2, 0, 3.2]) P.shape('darkGlass', archShape(1.3, 1.7, 1, 3), (x0 + x1) / 2 + o, H + 0.3, face + side * 0.07, side > 0 ? 0 : Math.PI);
  }

  // the clock tower (43 m)
  {
    const { x, z, a } = tower;
    const t1 = 29.8, c1 = 34.3;
    P.box('white', x - a, 0, z - a, x + a, t1, z + a);
    // quoins: offwhite corner strips up the shaft
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      P.box('offwhite', x + sx * a - 0.45, H, z + sz * a - 0.45, x + sx * a + 0.45, t1, z + sz * a + 0.45);
    }
    for (const y of [H - 0.7, 23.0]) P.box('offwhite', x - a - 0.35, y, z - a - 0.35, x + a + 0.35, y + 0.55, z + a + 0.35);
    // tall arched openings on the shaft above the roofs
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2, nx = Math.sin(ang), nz = Math.cos(ang);
      const fx = x + nx * (a + 0.06), fz = z + nz * (a + 0.06);
      P.shape(rand() < 0.5 ? 'windowLit' : 'darkGlass', archShape(1.6, 4.6, 1, 3), fx, 17.4, fz, ang);
      P.shape('darkGlass', archShape(1.4, 4.0, 1, 3), fx, 24.6, fz, ang);
    }
    // clock stage, slightly wider, with a clock on each face
    const A2 = a + 0.4;
    P.box('white', x - A2, t1, z - A2, x + A2, c1, z + A2);
    P.box('offwhite', x - A2 - 0.25, t1 - 0.1, z - A2 - 0.25, x + A2 + 0.25, t1 + 0.45, z + A2 + 0.25);
    P.box('offwhite', x - A2 - 0.4, c1 - 0.15, z - A2 - 0.4, x + A2 + 0.4, c1 + 0.55, z + A2 + 0.4);
    const cy = (t1 + c1) / 2 + 0.1;
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2;
      clock(P, x + Math.sin(ang) * (A2 + 0.02), cy, z + Math.cos(ang) * (A2 + 0.02), ang, 1.25);
    }
    // corner urns on the clock stage
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      P.box('offwhite', x + sx * (A2 - 0.1) - 0.45, c1 + 0.55, z + sz * (A2 - 0.1) - 0.45, x + sx * (A2 - 0.1) + 0.45, c1 + 1.7, z + sz * (A2 - 0.1) + 0.45);
      dome(P, 'white', x + sx * (A2 - 0.1), c1 + 1.7, z + sz * (A2 - 0.1), 0.42, 0.7, 'bulb', 6);
    }
    P.box('terracotta', x - A2 + 0.1, c1 + 0.55, z - A2 + 0.1, x + A2 - 0.1, c1 + 0.6, z + A2 - 0.1);
    // octagonal belvedere with arched openings and a dome
    const R = 3.4, b0 = c1 + 0.55, b1 = b0 + 3.6;
    P.add('white', shaft(R, b0, b1, 8, x, z));
    const ap = R * Math.cos(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4;
      P.shape(rand() < 0.5 ? 'windowLit' : 'darkGlass', archShape(1.3, 2.5, 1, 3), x + Math.sin(ang) * (ap + 0.05), b0 + 0.5, z + Math.cos(ang) * (ap + 0.05), ang);
    }
    P.add('offwhite', shaft(R + 0.3, b1, b1 + 0.4, 8, x, z, false));
    dome(P, 'white', x, b1 + 0.4, z, R + 0.05, 2.9, 'round', 12, 4);
    P.add('offwhite', shaft(0.45, b1 + 3.2, b1 + 3.9, 6, x, z, false));
    P.add('black', new THREE.ConeGeometry(0.1, 1.2, 4, 1, true).translate(x, b1 + 4.5, z));
  }

  finish(P, group, th);
  const dbg = triStats(group);
  return {
    group,
    notes: dbg + ' Footprint and both courtyards from OSM (relation 60184); 3 storeys and the 43 m tower as published, with a '
      + '2.5 m clock on each face. The tower and porch sit on the porch side of the footprint (local -z), which is not the '
      + 'side the front vector points to. Bay rhythm, pavilion heights, the belvedere and dome are illustrated.',
  };
}
