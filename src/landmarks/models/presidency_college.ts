// Presidency College, Chennai: the main heritage block on Kamarajar Salai by Robert Fellowes Chisholm
// (competition 1864, begun 1867, opened 1870; about 350 ft long). Red brick with grey granite and black polished
// gneiss columns, Italianate with Saracenic veranda arches and deep sunshades. Its most visible feature, the dome
// over the central block, was added for the college's Golden Jubilee in 1890 (described as painted pink).
//
// OSM (relation 14377740) maps the block as a long two-storey range facing the beach road (local +z) with a
// projecting central pavilion of two tower bays, a taller eastern wing and long wings running back. The walls run
// about 14 degrees off the landmark frame, so the model is built in a wall-aligned frame and rotated back.
import * as THREE from 'three';
import type { Landmark } from '../../data/types';
import type { Kit, LandmarkBuild } from '../kit';
import { Parts, archShape, rng, type V2 } from './_towers';
import {
  type Edge, type Plan, attic, band, clean, dome, edgesOf, finial, finish, gridAngle, inPlan, openings, parapet,
  pilasters, rect, roof, rotPt, rotPts, shaft, walls,
} from './_heritage';

const DOME: V2 = [286.0, 352.5]; // centre of the 1890 dome (world x, z); Google 2.5D has its high point here

export function build(lm: Landmark, kit: Kit): LandmarkBuild {
  const group = new THREE.Group();
  group.name = 'presidency_college';
  const P = new Parts(kit);
  const rand = rng(1870);

  let ring = clean(kit.ringLocal(lm));
  if (ring.length < 3) ring = rect(-80, -12, 80, 12);
  const th = gridAngle([ring]);
  const plan: Plan = { outer: rotPts(ring, th), holes: [] };
  const [du, dv] = rotPt(kit.toLocal(lm, DOME[0], DOME[1]), th);
  // the front (beach road) in the wall frame
  const fr = kit.frame(lm), f = lm.front ?? [0, 1];
  const lf: V2 = [f[0] * fr.cos + f[1] * fr.sin, -f[0] * fr.sin + f[1] * fr.cos];
  const fv = rotPt(lf, th);
  const fs = fv[1] >= 0 ? 1 : -1;
  const frontAng = fs > 0 ? 0 : Math.PI;

  const H = 11.6, F1 = 5.8;

  // the ranges
  walls(P, 'brick', plan, 0, H);
  band(P, 'stone', plan, 0, 0.8, 0.28);
  band(P, 'white', plan, F1 - 0.25, F1 + 0.2, 0.3);   // sunshade line between the storeys
  band(P, 'white', plan, H - 0.7, H, 0.5);            // deep eaves cornice
  parapet(P, 'brick', 'white', plan, H, 0.9);
  roof(P, 'terracotta', plan, H + 0.05, 0.3);

  // veranda arches on both storeys; black gneiss columns between the ground floor arches on the beach side
  const es = edgesOf(plan.outer);
  const facesFront = (e: Edge) => { let d = Math.abs(e.ang - frontAng) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d < 0.6; };
  openings(P, rand, es, { y: 0.9, h: 3.9, w: 2.5, bay: 4.2, point: 1.12, seg: 3, lit: 0.3, frame: 'white', fw: 0.25 });
  openings(P, rand, es, { y: F1 + 0.75, h: 3.4, w: 2.2, bay: 4.2, point: 1.12, seg: 3, lit: 0.35 });
  pilasters(P, 'black', es.filter(facesFront), { y0: 0.8, y1: F1 - 0.25, w: 0.5, bay: 4.2, out: 0.12 });

  // central pavilion: the two tower bays at the front, raised, with small domes; a gable between them
  const vs = plan.outer.map((p) => p[1]);
  const vFront = fs > 0 ? Math.max(...vs) : Math.min(...vs);
  const bayPts = plan.outer.filter((p) => Math.abs(p[1] - vFront) < 1.2).sort((a, b) => a[0] - b[0]);
  const bays: [number, number, number][] = [];
  for (let i = 0; i + 1 < bayPts.length; i += 2) bays.push([bayPts[i][0], bayPts[i + 1][0], (bayPts[i][1] + bayPts[i + 1][1]) / 2]);
  for (const [u0, u1, vb0] of bays) {
    const va = Math.min(vb0, vb0 - fs * 6.0), vb = Math.max(vb0, vb0 - fs * 6.0);
    const pts: V2[] = [[u0 + 0.3, va + 0.3], [u1 - 0.3, va + 0.3], [u1 - 0.3, vb - 0.3], [u0 + 0.3, vb - 0.3]];
    if (!pts.every((p) => inPlan(p, plan))) continue;
    const tb: Plan = { outer: rect(u0, va, u1, vb), holes: [] };
    walls(P, 'brick', tb, H, H + 4.4);
    band(P, 'white', tb, H + 3.8, H + 4.4, 0.35);
    roof(P, 'terracotta', tb, H + 4.4);
    openings(P, rand, edgesOf(tb.outer), { y: H + 0.9, h: 2.4, w: 1.4, bay: 3.0, point: 1.12, seg: 3, lit: 0.5, margin: 0.5, minLen: 2 });
    const cu = (u0 + u1) / 2, cv = (va + vb) / 2, r = Math.min(u1 - u0, vb - va) / 2 - 0.9;
    P.add('white', shaft(r + 0.25, H + 4.4, H + 5.0, 8, cu, cv, false));
    dome(P, 'terracotta', cu, H + 5.0, cv, r, r * 1.15, 'round', 10, 4);
    finial(P, 'gold', cu, H + 5.0 + r * 1.15 - 0.15, cv, 1.4);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      P.box('white', (sx > 0 ? u1 : u0) - 0.35, H + 4.4, (sz > 0 ? vb : va) - 0.35, (sx > 0 ? u1 : u0) + 0.35, H + 5.6, (sz > 0 ? vb : va) + 0.35);
    }
  }
  if (bays.length >= 2) {
    // entrance bay between the towers: a raised gable on the front and a tall arched doorway
    const ua = bays[0][1], ub = bays[1][0], cu = (ua + ub) / 2;
    const ent = plan.outer.filter((p) => p[0] > ua - 0.3 && p[0] < ub + 0.3 && Math.abs(p[1] - vFront) > 2).map((p) => p[1]);
    const vE = ent.length ? (fs > 0 ? Math.max(...ent) : Math.min(...ent)) : vFront - fs * 7;
    const g = new THREE.Shape();
    const w = (ub - ua) / 2;
    g.moveTo(-w, 0); g.lineTo(w, 0); g.lineTo(w, 1.0); g.lineTo(0, 3.6); g.lineTo(-w, 1.0); g.closePath();
    P.shape('brick', g, cu, H + 0.9, vE + fs * 0.02, frontAng);
    P.shape('white', archShape(4.6, 9.0, 1.12, 3), cu, 0, vE + fs * 0.07, frontAng);
    P.shape('windowLit', archShape(3.8, 8.4, 1.12, 3), cu, 0, vE + fs * 0.11, frontAng);
  }

  // the taller eastern wing (Google 2.5D: about 3 m above the main range)
  {
    const cand = plan.outer.filter((p) => (p[0] - du) > 50 && (p[1] - dv) * fs < 3);
    if (cand.length >= 3) {
      const u0 = Math.min(...cand.map((p) => p[0])), u1 = Math.max(...cand.map((p) => p[0]));
      const v0 = Math.min(...cand.map((p) => p[1])), v1 = Math.max(...cand.map((p) => p[1]));
      const pts: V2[] = [[u0 + 0.5, v0 + 0.5], [u1 - 0.5, v0 + 0.5], [u1 - 0.5, v1 - 0.5], [u0 + 0.5, v1 - 0.5]];
      if (pts.every((p) => inPlan(p, plan))) {
        attic(P, rand, u0, v0, u1, v1, H + 0.05, H + 2.9, { wall: 'brick', roof: 'terracotta', trim: 'white', lit: 0.4, bay: 4.2, win: 1.8 });
      }
    }
  }

  // the 1890 dome: octagonal drum with arched lights, a pink dome, lantern and finial
  {
    const DR = 6.0, d0 = H + 0.05, d1 = H + 4.2;
    P.add('brick', shaft(DR, d0, d1, 8, du, dv, false));
    P.add('white', shaft(DR + 0.15, d1 - 0.5, d1 + 0.1, 8, du, dv));
    P.add('white', shaft(DR + 0.1, d0, d0 + 0.5, 8, du, dv));
    const ap = DR * Math.cos(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4, nx = Math.sin(a), nz = Math.cos(a);
      P.shape(rand() < 0.5 ? 'windowLit' : 'darkGlass', archShape(1.6, 2.6, 1.12, 3), du + nx * (ap + 0.05), d0 + 0.75, dv + nz * (ap + 0.05), a);
    }
    const dh = 6.6;
    dome(P, 'terracotta', du, d1 + 0.1, dv, DR - 0.1, dh, 'round', 16, 5);
    // white ribs over the dome
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      const prof: V2[] = [];
      for (let i = 0; i <= 4; i++) {
        const t = (i / 4) * (Math.PI / 2) * 0.92;
        prof.push([(DR - 0.05) * Math.cos(t), dh * Math.sin(t)]);
      }
      for (let i = 0; i + 1 < prof.length; i++) {
        const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
        const len = Math.hypot(r1 - r0, y1 - y0);
        const g = new THREE.BoxGeometry(0.28, len, 0.12);
        g.rotateZ(-Math.atan2(r1 - r0, y1 - y0));
        g.translate((r0 + r1) / 2, (y0 + y1) / 2, 0);
        g.rotateY(a - Math.PI / 2);
        g.translate(du, d1 + 0.1, dv);
        P.add('white', g);
      }
    }
    const lt = d1 + 0.1 + dh - 0.25;
    P.add('white', shaft(0.95, lt, lt + 1.6, 6, du, dv));
    dome(P, 'terracotta', du, lt + 1.6, dv, 1.05, 1.0, 'round', 6, 3);
    finial(P, 'gold', du, lt + 2.5, dv, 1.6);
  }

  finish(P, group, th);
  return {
    group,
    notes: 'Main block footprint from OSM (relation 14377740, building way 31900265). The dome stands where Google 2.5D '
      + 'heights peak, over the central pavilion; two storeys, the taller eastern wing and the black gneiss columns follow '
      + 'published descriptions. Tower bay caps, the gable, dome ribs and the pink (terracotta) dome colour are illustrated.',
  };
}
