// Public Works Department building, Chepauk (OSM way 31897155, historic=building). Robert Chisholm's offices for
// the PWD, built 1866-67 as one of his first Madras contracts: a long range on the beach-road face of the Chepauk
// Palace grounds that screened the palace from public view, with Presidency College built next to it to the south.
// Madras Musings calls it Indo-Saracenic; Sriram V calls Chisholm's early PWD office Scottish-baronial.
//
// Modelled as two storeys of arched verandas in red brick with cream trim (Google 2.5D heights put the ranges at
// about 8 to 10 m), the long frontage on Kamarajar Salai (local -x here: the front vector points along the long
// axis) with a central entrance tower, and round corner turrets with conical caps as the baronial touch.
import * as THREE from 'three';
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild, MatName } from '../kit';
import { Parts, archShape, flat, rng, squareCap, type V2 } from './_towers';
import {
  type Edge, type Plan, along, band, clean, corners, edgesOf, finial, finish, gridAngle, openings, parapet, rect, roof,
  rotPt, rotPts, shaft, walls,
} from './_heritage';

const WALL: MatName = 'brick', TRIM: MatName = 'cream', ROOF: MatName = 'terracotta', CAP: MatName = 'roofRed';

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const group = new THREE.Group();
  group.name = 'pwd_building';
  const P = new Parts(kit);
  const rand = rng(1867);

  let ring = clean(kit.ringLocal(lm));
  if (ring.length < 3) ring = rect(-80, -15, 80, 15);
  const th = gridAngle([ring]);
  const plan: Plan = { outer: rotPts(ring, th), holes: [] };

  // the frontage: the longest wall facing the main road (Kamarajar Salai)
  const fr = kit.frame(lm), f = lm.front ?? [0, 1];
  const fl = rotPt([f[0] * fr.cos + f[1] * fr.sin, -f[0] * fr.sin + f[1] * fr.cos], th);
  const es = edgesOf(plan.outer);
  const score = (e: Edge) => e.len * Math.max(0, e.n[0] * fl[0] + e.n[1] * fl[1]);
  const front = es.reduce((a, e) => (score(e) > score(a) ? e : a), es[0]);

  const H = 9.8, F1 = 4.9;

  // ranges: walls, plinth, cream bands, parapet and red-oxide terraces
  walls(P, WALL, plan, 0, H);
  band(P, 'stone', plan, 0, 0.7, 0.25);
  band(P, TRIM, plan, F1 - 0.2, F1 + 0.2, 0.25);
  band(P, TRIM, plan, H - 0.55, H, 0.4);
  parapet(P, WALL, TRIM, plan, H, 0.9);
  roof(P, ROOF, plan, H + 0.05, 0.3);

  // the entrance tower stands at the middle of the frontage, flush with it
  const TA = 5.4;
  const mid = front.len / 2;
  // the tower stands 0.6 m proud of the frontage so its entrance arch clears the string courses
  const tc = [front.a[0] + front.t[0] * mid - front.n[0] * (TA - 0.6), front.a[1] + front.t[1] * mid - front.n[1] * (TA - 0.6)] as V2;
  const PW = 6.2;
  const pavs = [0.2, 0.8].map((k) => along(front, front.len * k));
  const nearPav = (p: V2) => pavs.some((c) => {
    const dx = p[0] - c[0], dz = p[1] - c[1];
    return Math.abs(dx * front.t[0] + dz * front.t[1]) < PW + 0.6 && Math.abs(dx * front.n[0] + dz * front.n[1]) < 1.5;
  });
  const nearTower = (p: V2) => Math.hypot(p[0] - tc[0], p[1] - tc[1]) < TA * 1.45 || nearPav(p);

  // verandas: pointed arches, cream heads on the ground floor; the frontage gets the full treatment
  openings(P, rand, es, { y: 0.8, h: 3.3, w: 2.1, bay: 4.3, point: 1.25, lit: 0.3, frame: TRIM, fw: 0.25, skip: nearTower });
  openings(P, rand, es, { y: F1 + 0.65, h: 2.9, w: 1.8, bay: 4.3, point: 1.25, lit: 0.35, skip: nearTower });

  // round corner turrets with conical caps on the main corners
  for (const c of corners(plan.outer, 12)) {
    const x = c.p[0] - c.d[0] * 0.6, z = c.p[1] - c.d[1] * 0.6;
    if (nearTower([x, z])) continue;
    P.add(WALL, shaft(1.5, 0, H + 2.6, 8, x, z));
    P.add(TRIM, shaft(1.62, F1 - 0.2, F1 + 0.2, 8, x, z));
    P.add(TRIM, shaft(1.75, H + 2.6, H + 2.95, 8, x, z, false));
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 8;
      P.shape('darkGlass', archShape(0.7, 1.4, 1.25, 2), x + Math.sin(a) * 1.44, H + 0.6, z + Math.cos(a) * 1.44, a);
    }
    P.add(CAP, flat(new THREE.ConeGeometry(1.95, 3.6, 8, 1, true, Math.PI / 8)).translate(x, H + 2.95 + 1.8, z));
    P.add('gold', new THREE.ConeGeometry(0.08, 0.9, 4, 1, true).translate(x, H + 2.95 + 3.6 + 0.35, z));
  }

  // crow-stepped gables on the frontage, a quarter of the way in from each end
  const steps = new THREE.Shape();
  {
    const w = 5.4, sh = [[w, 0], [w, 0.8], [w * 0.72, 0.8], [w * 0.72, 1.7], [w * 0.44, 1.7], [w * 0.44, 2.6], [w * 0.16, 2.6], [w * 0.16, 3.3]];
    steps.moveTo(-w, 0);
    for (const [x, y] of sh) steps.lineTo(x, y);
    for (let i = sh.length - 1; i >= 1; i--) steps.lineTo(-sh[i][0], sh[i][1]);
    steps.closePath();
  }
  // gabled frontispiece bays a fifth of the way in from each end, full height and 0.6 m proud of the frontage
  for (const c of pavs) {
    const t = front.t, n = front.n, hw = PW, top = H + 3.6;
    const pts: V2[] = [
      [c[0] - t[0] * hw + n[0] * 0.6, c[1] - t[1] * hw + n[1] * 0.6], [c[0] + t[0] * hw + n[0] * 0.6, c[1] + t[1] * hw + n[1] * 0.6],
      [c[0] + t[0] * hw - n[0] * 8.4, c[1] + t[1] * hw - n[1] * 8.4], [c[0] - t[0] * hw - n[0] * 8.4, c[1] - t[1] * hw - n[1] * 8.4],
    ];
    const pv: Plan = { outer: pts, holes: [] };
    walls(P, WALL, pv, 0, top);
    band(P, 'stone', pv, 0, 0.7, 0.25);
    band(P, TRIM, pv, F1 - 0.2, F1 + 0.2, 0.25);
    band(P, TRIM, pv, H - 0.55, H - 0.15, 0.25);
    band(P, TRIM, pv, top - 0.5, top, 0.4);
    roof(P, ROOF, pv, top);
    const fe = edgesOf(pts).filter((e) => e.n[0] * n[0] + e.n[1] * n[1] > 0.9);
    openings(P, rand, fe, { y: 0.8, h: 3.3, w: 2.1, bay: 4.0, point: 1.25, lit: 0.4, frame: TRIM, fw: 0.25, margin: 0.8 });
    openings(P, rand, fe, { y: F1 + 0.65, h: 2.9, w: 1.8, bay: 4.0, point: 1.25, lit: 0.4, margin: 0.8 });
    openings(P, rand, edgesOf(pts), { y: H + 0.6, h: 2.0, w: 1.3, bay: 3.2, point: 1.25, lit: 0.45, margin: 0.8 });
    const g = [c[0] + n[0] * 0.85, c[1] + n[1] * 0.85];
    P.shape(WALL, steps, g[0], top, g[1], front.ang);
    P.shape(TRIM, archShape(1.5, 1.9, 1.25, 2), g[0] + n[0] * 0.04, top + 0.4, g[1] + n[1] * 0.04, front.ang);
    P.shape('darkGlass', archShape(1.1, 1.6, 1.25, 2), g[0] + n[0] * 0.08, top + 0.5, g[1] + n[1] * 0.08, front.ang);
  }

  // the entrance tower: square shaft, arched entrance, corner bartizans and a tall pyramidal cap
  {
    const [x, z] = tc, top = 19.4;
    P.box(WALL, x - TA, 0, z - TA, x + TA, top, z + TA);
    for (const y of [H - 0.55, 14.4]) P.box(TRIM, x - TA - 0.22, y, z - TA - 0.22, x + TA + 0.22, y + 0.4, z + TA + 0.22);
    P.box(TRIM, x - TA - 0.4, top - 0.5, z - TA - 0.4, x + TA + 0.4, top + 0.15, z + TA + 0.4);
    const tp = edgesOf(rect(x - TA, z - TA, x + TA, z + TA));
    // entrance arch on the frontage face, lights on the upper stages of every face
    const nx = front.n[0], nz = front.n[1];
    const fx = x + nx * (TA + 0.05), fz = z + nz * (TA + 0.05);
    P.shape(TRIM, archShape(4.0, 6.4, 1.25, 3), fx, 0, fz, front.ang);
    P.shape('windowLit', archShape(3.3, 5.9, 1.25, 3), fx + nx * 0.04, 0, fz + nz * 0.04, front.ang);
    openings(P, rand, tp, { y: H + 0.8, h: 2.8, w: 1.4, bay: 3.0, point: 1.25, lit: 0.5, margin: 1.3, frame: TRIM, fw: 0.2 });
    openings(P, rand, tp, { y: 15.4, h: 2.6, w: 1.2, bay: 3.0, point: 1.25, lit: 0.4, margin: 1.3 });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const bx = x + sx * (TA - 0.15), bz = z + sz * (TA - 0.15);
      P.add(WALL, shaft(0.95, 14.0, top + 1.5, 8, bx, bz));
      P.add(TRIM, shaft(1.08, top + 1.5, top + 1.75, 8, bx, bz, false));
      P.add(CAP, flat(new THREE.ConeGeometry(1.25, 2.8, 8, 1, true, Math.PI / 8)).translate(bx, top + 1.75 + 1.4, bz));
    }
    P.add(CAP, squareCap(TA - 0.3, 7.2, 1.15, 0.35).translate(x, top + 0.15, z));
    finial(P, 'gold', x, top + 0.15 + 7.0, z, 1.8);
  }

  finish(P, group, th);
  return {
    group,
    notes: 'Footprint from OSM (way 31897155). Builder, date and the beach-road frontage from published accounts; heights '
      + 'from Google 2.5D (about 8 to 10 m). The facade (arches, entrance tower, conical-capped turrets, stepped gables) and '
      + 'the red brick with cream trim scheme are illustrated: no detailed description of this building was found.',
  };
}
