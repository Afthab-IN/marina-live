// Chepauk Palace (completed 1768 for the Nawab of the Carnatic, engineer Paul Benfield), one of the first
// Indo-Saracenic buildings in India: red brick and lime, mapped by OSM as two blocks (relation 14377429).
//  - Kalas Mahal, the southern block: two storeys with minareted entrances and small domes, plus a lower
//    western wing joined by a narrow link.
//  - Humayun Mahal, the northern block: rebuilt by Robert Chisholm (1868 to 1871) with a first floor, a Madras
//    terrace roof, arched verandas, a frontage on Wallajah Road (local +x) and an eastern entrance facing the beach.
//  - Chisholm's domed tower with corner minarets that links the two blocks (about 75 ft); OSM maps its base as
//    the small square projection of the Kalas Mahal ring, and a corridor joins it to Humayun Mahal.
import * as THREE from 'three';
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild, MatName } from '../kit';
import { Parts, archShape, rng, type V2 } from './_towers';
import {
  type Plan, attic, band, chhatri, clean, corners, dome, edgesOf, finial, finish, gridAngle, inside, minaret, openings,
  parapet, rect, roof, rotPt, rotPts, walls,
} from './_heritage';

const TOWER: V2 = [294.1, -185.5]; // centre of the linking tower base (world x, z)

const WALL: MatName = 'terracotta', TRIM: MatName = 'cream', ROOF: MatName = 'stone', DOME: MatName = 'white';

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const group = new THREE.Group();
  group.name = 'chepauk_palace';
  const P = new Parts(kit);
  const rand = rng(1768);

  const src = lm.parts?.length ? lm.parts : lm.ring ? [lm.ring] : [];
  let rings = src.map((r) => clean(kit.lineLocal(lm, r))).filter((r) => r.length >= 3);
  if (!rings.length) rings = [rect(-90, -25, 0, 25), rect(10, -30, 80, 30)];
  const th = gridAngle(rings);
  const R = rings.map((r) => rotPts(r, th));
  const [tu, tv] = rotPt(kit.toLocal(lm, TOWER[0], TOWER[1]), th);

  // the ring that carries the tower projection is Kalas Mahal; the other is Humayun Mahal
  const dist = (r: V2[]) => Math.min(...r.map((p) => Math.hypot(p[0] - tu, p[1] - tv)));
  R.sort((a, b) => dist(a) - dist(b));
  const kalas = R[0], humayun = R.length > 1 ? R[1] : null;

  // split Kalas Mahal into the tower base, the main block and the lower western wing
  const isTower = (p: V2) => Math.abs(p[1] - tv) < 8 && (p[0] - tu) * Math.sign(tu - centroid(kalas)[0]) > -3;
  const towerPts = kalas.filter(isTower);
  let body = kalas.filter((p) => !isTower(p));
  const main = bbox(body.filter((p) => Math.abs(p[0] - tu) < 70));
  // western wing: the run of points well beyond the main block's far face, between its long faces
  const farU = Math.abs(main.u0 - tu) > Math.abs(main.u1 - tu) ? main.u0 : main.u1;
  const sgn = Math.sign(farU - tu);
  const wing = body.filter((p) => (p[0] - farU) * sgn > -0.6 && p[1] > main.v0 + 1.5 && p[1] < main.v1 - 1.5);
  const mainPlan: Plan = { outer: rect(main.u0, main.v0, main.u1, main.v1), holes: [] };
  const wingPlan: Plan | null = wing.length >= 3 ? { outer: clean(wing), holes: [] } : null;

  // ------------------------------------------------------------------- Kalas Mahal (south block)
  const H = 12.6, F1 = 6.3, HW = 9.4;
  storeyBlock(P, rand, mainPlan, H, F1, { skip: (p) => !!wingPlan && inside(p, wingPlan.outer) });
  if (wingPlan) {
    walls(P, WALL, wingPlan, 0, HW);
    band(P, 'stone', wingPlan, 0, 0.7, 0.25);
    band(P, TRIM, wingPlan, 4.6, 4.95, 0.22);
    band(P, TRIM, wingPlan, HW - 0.55, HW, 0.35);
    parapet(P, WALL, TRIM, wingPlan, HW, 0.9);
    roof(P, ROOF, wingPlan, HW + 0.05, 0.3);
    const es = edgesOf(wingPlan.outer).filter((e) => !(Math.abs(e.a[0] - farU) < 0.8 && Math.abs(e.b[0] - farU) < 0.8));
    const notMain = (p: V2) => inside(p, mainPlan.outer);
    openings(P, rand, es, { y: 0.9, h: 3.2, w: 1.9, bay: 4.0, point: 1.25, lit: 0.3, frame: TRIM, fw: 0.25, skip: notMain });
    openings(P, rand, es, { y: 5.6, h: 2.8, w: 1.6, bay: 4.0, point: 1.25, lit: 0.3, skip: notMain });
    for (const c of corners(wingPlan.outer, 4.5)) {
      if (inside([c.p[0] + c.d[0] * 2, c.p[1] + c.d[1] * 2], mainPlan.outer)) continue;
      minaret(P, c.p[0] - c.d[0] * 0.5, c.p[1] - c.d[1] * 0.5, { r: 1.0, y0: 0, y1: HW + 2.2, body: WALL, trim: TRIM, bands: [HW - 0.5], dome: DOME, domeH: 2.0, tip: 'gold' });
    }
  }
  // corner turrets of the main block
  for (const c of corners(mainPlan.outer, 8)) {
    minaret(P, c.p[0] - c.d[0] * 0.5, c.p[1] - c.d[1] * 0.5, { r: 1.25, y0: 0, y1: H + 2.6, body: WALL, trim: TRIM, bands: [F1 - 0.2, H - 0.5], dome: DOME, domeH: 2.4, tip: 'gold' });
  }
  // the two minareted entrances, centred on the long faces
  const um = (main.u0 + main.u1) / 2;
  for (const [v, s] of [[main.v0, -1], [main.v1, 1]] as const) {
    const ang = s > 0 ? 0 : Math.PI;
    P.box(WALL, um - 4.2, 0, v - s * 1.0, um + 4.2, H + 2.4, v + s * 1.4);
    P.box(TRIM, um - 4.5, H + 1.9, v - s * 1.0, um + 4.5, H + 2.5, v + s * 1.7);
    P.shape(TRIM, archShape(5.0, 8.6, 1.25, 3), um, 0, v + s * 1.45, ang);
    P.shape('windowLit', archShape(4.2, 8.0, 1.25, 3), um, 0, v + s * 1.5, ang);
    for (const o of [-5.4, 5.4]) {
      minaret(P, um + o, v + s * 0.9, { r: 1.2, y0: 0, y1: H + 5.2, body: WALL, trim: TRIM, bands: [F1 - 0.2, H - 0.5, H + 2.6], dome: DOME, domeH: 2.6, kind: 'onion', tip: 'gold' });
    }
  }
  // small domes on the Kalas Mahal terrace
  for (const f of [0.25, 0.75]) chhatri(P, main.u0 + (main.u1 - main.u0) * f, (main.v0 + main.v1) / 2, H + 0.05, 1.5, 2.6, TRIM, DOME, 'gold');

  // ------------------------------------------------------------------- the linking tower
  if (towerPts.length >= 2) {
    const tb = bbox([...towerPts, ...kalas.filter((p) => Math.abs(p[1] - tv) < 8 && Math.abs(p[0] - tu) < 7)]);
    const u0 = tb.u0, u1 = tb.u1, v0 = tb.v0, v1 = tb.v1, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const t1 = 19.6, t2 = 23.0;
    P.box(WALL, u0, 0, v0, u1, t1, v1);
    for (const y of [F1 - 0.2, H - 0.5, 18.6]) P.box(TRIM, u0 - 0.25, y, v0 - 0.25, u1 + 0.25, y + 0.4, v1 + 0.25);
    P.box(TRIM, u0 - 0.4, t1 - 0.5, v0 - 0.4, u1 + 0.4, t1 + 0.1, v1 + 0.4);
    const te = edgesOf(rect(u0, v0, u1, v1));
    const free = (p: V2) => !inside(p, mainPlan.outer);
    openings(P, rand, te, { y: 1.0, h: 4.4, w: 2.2, bay: 4.0, point: 1.25, lit: 0.4, frame: TRIM, fw: 0.25, skip: (p) => !free(p) });
    openings(P, rand, te, { y: 7.2, h: 3.6, w: 1.8, bay: 4.0, point: 1.25, lit: 0.4, skip: (p) => !free(p) });
    openings(P, rand, te, { y: 14.4, h: 3.6, w: 1.6, bay: 3.2, point: 1.25, lit: 0.3 });
    // upper stage with arched lights, four corner minarets and the dome
    const a = Math.min(u1 - u0, v1 - v0) / 2 - 1.3;
    P.box(WALL, cu - a, t1 + 0.1, cv - a, cu + a, t2, cv + a);
    P.box(TRIM, cu - a - 0.25, t2 - 0.4, cv - a - 0.25, cu + a + 0.25, t2 + 0.15, cv + a + 0.25);
    openings(P, rand, edgesOf(rect(cu - a, cv - a, cu + a, cv + a)), { y: t1 + 0.6, h: 2.3, w: 1.1, bay: 2.4, point: 1.25, lit: 0.5, margin: 0.4 });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      minaret(P, cu + sx * ((u1 - u0) / 2 - 0.6), cv + sz * ((v1 - v0) / 2 - 0.6), { r: 0.75, y0: t1 + 0.1, y1: t2 + 1.3, body: WALL, trim: TRIM, dome: DOME, domeH: 1.6, tip: 'gold' });
    }
    dome(P, DOME, cu, t2 + 0.15, cv, a - 0.2, 5.0, 'onion', 12);
    finial(P, 'gold', cu, t2 + 0.15 + 4.8, cv, 1.8);
    // corridor to Humayun Mahal
    if (humayun) {
      const hb = bbox(humayun);
      const toward = Math.sign((hb.u0 + hb.u1) / 2 - cu);
      const ca = toward > 0 ? u1 : hb.u1, cb = toward > 0 ? hb.u0 : u0;
      const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
      if (hi - lo > 0.5) {
        const cp: Plan = { outer: rect(lo, cv - 3.2, hi, cv + 3.2), holes: [] };
        walls(P, WALL, cp, 0, 8.6);
        band(P, TRIM, cp, 8.1, 8.6, 0.25);
        roof(P, ROOF, cp, 8.6);
        openings(P, rand, edgesOf(cp.outer), { y: 0.9, h: 3.0, w: 1.6, bay: 3.0, point: 1.25, lit: 0.4, minLen: 3, margin: 0.3 });
        openings(P, rand, edgesOf(cp.outer), { y: 4.9, h: 2.6, w: 1.4, bay: 3.0, point: 1.25, lit: 0.4, minLen: 3, margin: 0.3 });
      }
    }
  }

  // ------------------------------------------------------------------- Humayun Mahal (north block)
  if (humayun) {
    const hp: Plan = { outer: humayun, holes: [] };
    const hb = bbox(humayun);
    storeyBlock(P, rand, hp, H, F1, {});
    for (const c of corners(rect(hb.u0, hb.v0, hb.u1, hb.v1), 8)) {
      minaret(P, c.p[0] - c.d[0] * 0.5, c.p[1] - c.d[1] * 0.5, { r: 1.25, y0: 0, y1: H + 2.4, body: WALL, trim: TRIM, bands: [F1 - 0.2, H - 0.5], dome: DOME, domeH: 2.4, tip: 'gold' });
    }
    // the raised Durbar Hall (Diwan-e-Khana) roof in the middle
    const cu = (hb.u0 + hb.u1) / 2, cv = (hb.v0 + hb.v1) / 2;
    attic(P, rand, cu - 11, cv - 11, cu + 11, cv + 11, H + 0.05, H + 3.6, { wall: WALL, roof: ROOF, trim: TRIM, lit: 0.45, bay: 3.0 });
    // frontage on Wallajah Road (the face furthest from the tower): central bay with two minarets
    const fu = Math.abs(hb.u1 - tu) > Math.abs(hb.u0 - tu) ? hb.u1 : hb.u0, s = Math.sign(fu - tu);
    const ang = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    P.box(WALL, Math.min(fu - s * 1.2, fu + s * 1.4), 0, cv - 6, Math.max(fu - s * 1.2, fu + s * 1.4), H + 2.4, cv + 6);
    P.box(TRIM, Math.min(fu - s * 1.2, fu + s * 1.7), H + 1.9, cv - 6.3, Math.max(fu - s * 1.2, fu + s * 1.7), H + 2.5, cv + 6.3);
    P.shape(TRIM, archShape(5.4, 9.0, 1.25, 3), fu + s * 1.45, 0, cv, ang);
    P.shape('windowLit', archShape(4.6, 8.4, 1.25, 3), fu + s * 1.5, 0, cv, ang);
    for (const o of [-7.2, 7.2]) {
      minaret(P, fu + s * 0.9, cv + o, { r: 1.15, y0: 0, y1: H + 4.6, body: WALL, trim: TRIM, bands: [F1 - 0.2, H - 0.5], dome: DOME, domeH: 2.5, kind: 'onion', tip: 'gold' });
    }
    // eastern entrance porch facing the beach (+z side of the model)
    const pv = rotPt([0, 1], th)[1] >= 0 ? hb.v1 : hb.v0, ps = pv === hb.v1 ? 1 : -1;
    const pp: Plan = { outer: rect(cu - 6, Math.min(pv, pv + ps * 4), cu + 6, Math.max(pv, pv + ps * 4)), holes: [] };
    walls(P, WALL, pp, 0, 6.8);
    band(P, TRIM, pp, 6.2, 6.8, 0.3);
    parapet(P, WALL, TRIM, pp, 6.8, 0.8);
    roof(P, ROOF, pp, 6.85, 0.3);
    openings(P, rand, edgesOf(pp.outer), { y: 0, h: 5.2, w: 2.6, bay: 3.6, point: 1.25, lit: 0.5, frame: TRIM, fw: 0.3, minLen: 3, margin: 0.4, skip: (p) => Math.abs(p[1] - pv) < 0.5 });
  }

  finish(P, group, th);
  return {
    group,
    notes: 'Both blocks from OSM (relation 14377429, ways 31897161 and 31897159). The tower stands on the square '
      + 'projection of the Kalas Mahal ring (about 75 ft to the dome). Storey heights, wing heights, minaret and dome '
      + 'placement, the raised Durbar Hall roof and the terracotta with cream trim scheme are illustrated.',
  };
}

function bbox(pts: V2[]) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [u, v] of pts) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  return { u0, u1, v0, v1 };
}
function centroid(pts: V2[]): V2 {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
}

/** Two-storey palace range: walls, plinth, bands, parapet, terrace and two rows of pointed arches. */
function storeyBlock(P: Parts, rand: () => number, plan: Plan, H: number, F1: number, o: { skip?: (p: V2) => boolean }) {
  walls(P, WALL, plan, 0, H);
  band(P, 'stone', plan, 0, 0.8, 0.28);
  band(P, TRIM, plan, F1 - 0.2, F1 + 0.25, 0.25);
  band(P, TRIM, plan, H - 0.6, H, 0.4);
  parapet(P, WALL, TRIM, plan, H, 1.0);
  roof(P, ROOF, plan, H + 0.05, 0.3);
  const es = edgesOf(plan.outer);
  openings(P, rand, es, { y: 1.0, h: 4.2, w: 2.3, bay: 4.2, point: 1.25, lit: 0.3, frame: TRIM, fw: 0.28, skip: o.skip });
  openings(P, rand, es, { y: F1 + 0.9, h: 3.5, w: 1.9, bay: 4.2, point: 1.25, lit: 0.35, skip: o.skip });
}
